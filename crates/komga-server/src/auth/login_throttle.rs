//! Failed password logins per account. After `MAX_FAILURES` failures in a row (none more
//! than `FAILURE_WINDOW` apart, counted from the end of a lock) the account refuses
//! password logins for a while: one minute at first, doubling with every further failure
//! up to `MAX_LOCK`. A successful login clears the count.
//!
//! - Keyed by user id: only existing accounts are counted, so guessing made-up emails
//!   cannot grow the map. Not keyed by client address, which comes from the
//!   `X-Forwarded-For` header and can be set to anything by the client.
//! - Only password (Basic) logins are refused. Sessions, API keys and remember-me cookies
//!   keep working, so devices that are already signed in are not affected.
//! - An attempt counts when it starts, under the same lock as the check, so concurrent
//!   guesses cannot all slip past it; a correct password then clears the count.
//! - A refused attempt answers like a wrong password without checking it, and does not
//!   extend the lock: retrying while locked never makes the wait longer. The lock only
//!   grows when an attempt after it ends starts.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_FAILURES: u32 = 5;
const FAILURE_WINDOW: Duration = Duration::from_secs(10 * 60);
const FIRST_LOCK: Duration = Duration::from_secs(60);
const MAX_LOCK: Duration = Duration::from_secs(15 * 60);

struct Failures {
    count: u32,
    last: Instant,
    lock: Duration,
    locked_until: Option<Instant>,
}

impl Failures {
    /// Kept while a further failure would still count: until `FAILURE_WINDOW` after the
    /// last failure or, when locked, after the lock ends (a lock can outlast the window).
    fn is_live(&self, now: Instant) -> bool {
        let since = self
            .locked_until
            .map_or(self.last, |until| until.max(self.last));
        now.saturating_duration_since(since) < FAILURE_WINDOW
    }
}

#[derive(Default)]
pub struct LoginThrottle {
    accounts: Mutex<HashMap<String, Failures>>,
}

impl LoginThrottle {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts a password attempt for the account, counted as a failure until
    /// `record_success`. `None` while the account is locked; otherwise the lock this
    /// attempt starts, if any, which holds unless the attempt succeeds.
    pub fn begin_attempt(&self, user_id: &str, now: Instant) -> Option<Option<Duration>> {
        let mut accounts = self.accounts.lock().unwrap();
        if accounts
            .get(user_id)
            .and_then(|failures| failures.locked_until)
            .is_some_and(|until| until > now)
        {
            return None;
        }
        if !accounts.contains_key(user_id) {
            // a new key is the only way the map grows: drop the entries that are done
            accounts.retain(|_, failures| failures.is_live(now));
        }
        let failures = accounts
            .entry(user_id.to_string())
            .or_insert_with(|| Failures {
                count: 0,
                last: now,
                lock: Duration::ZERO,
                locked_until: None,
            });
        if !failures.is_live(now) {
            *failures = Failures {
                count: 0,
                last: now,
                lock: Duration::ZERO,
                locked_until: None,
            };
        }
        failures.count += 1;
        failures.last = now;
        if failures.count >= MAX_FAILURES {
            failures.lock = if failures.lock.is_zero() {
                FIRST_LOCK
            } else {
                (failures.lock * 2).min(MAX_LOCK)
            };
            failures.locked_until = Some(now + failures.lock);
            return Some(Some(failures.lock));
        }
        Some(None)
    }

    /// A successful password login clears the account's failures.
    pub fn record_success(&self, user_id: &str) {
        self.accounts.lock().unwrap().remove(user_id);
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.accounts.lock().unwrap().len()
    }

    #[cfg(test)]
    fn is_locked(&self, user_id: &str, now: Instant) -> bool {
        self.accounts
            .lock()
            .unwrap()
            .get(user_id)
            .and_then(|failures| failures.locked_until)
            .is_some_and(|until| until > now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fail_times(throttle: &LoginThrottle, user_id: &str, start: Instant, n: u32) -> Instant {
        let mut now = start;
        for _ in 0..n {
            assert!(throttle.begin_attempt(user_id, now).is_some());
            now += Duration::from_secs(1);
        }
        now
    }

    #[test]
    fn locks_after_max_failures_for_one_minute() {
        let throttle = LoginThrottle::new();
        let t0 = Instant::now();
        let after_four = fail_times(&throttle, "u1", t0, MAX_FAILURES - 1);
        assert!(!throttle.is_locked("u1", after_four));

        assert_eq!(
            throttle.begin_attempt("u1", after_four),
            Some(Some(FIRST_LOCK))
        );
        assert!(throttle.is_locked("u1", after_four));
        // further attempts are refused, also concurrent ones that start now
        assert_eq!(throttle.begin_attempt("u1", after_four), None);
        assert!(throttle.is_locked("u1", after_four + Duration::from_secs(59)));
        assert!(!throttle.is_locked("u1", after_four + FIRST_LOCK));
        // other accounts are unaffected
        assert!(!throttle.is_locked("u2", after_four));
    }

    #[test]
    fn each_further_failure_doubles_the_lock_up_to_the_cap() {
        let throttle = LoginThrottle::new();
        let mut now = fail_times(&throttle, "u1", Instant::now(), MAX_FAILURES);
        let mut expected = FIRST_LOCK;
        for _ in 0..6 {
            now += expected; // the lock has just run out
            expected = (expected * 2).min(MAX_LOCK);
            assert_eq!(throttle.begin_attempt("u1", now), Some(Some(expected)));
            assert!(throttle.is_locked("u1", now + expected - Duration::from_secs(1)));
            assert!(!throttle.is_locked("u1", now + expected));
        }
        assert_eq!(expected, MAX_LOCK);
    }

    #[test]
    fn success_and_quiet_periods_reset_the_count() {
        let throttle = LoginThrottle::new();
        let t0 = Instant::now();
        let now = fail_times(&throttle, "u1", t0, MAX_FAILURES - 1);
        throttle.record_success("u1");
        let now = fail_times(&throttle, "u1", now, MAX_FAILURES - 1);
        assert!(!throttle.is_locked("u1", now));

        // failures further apart than the window start over
        let later = now + FAILURE_WINDOW;
        assert_eq!(throttle.begin_attempt("u1", later), Some(None));
        assert!(!throttle.is_locked("u1", later));
    }

    #[test]
    fn finished_entries_are_dropped_when_a_new_account_fails() {
        let throttle = LoginThrottle::new();
        let t0 = Instant::now();
        assert!(throttle.begin_attempt("u1", t0).is_some());
        fail_times(&throttle, "u2", t0, MAX_FAILURES);
        assert_eq!(throttle.len(), 2);

        // u1's single failure is past the window; u2's lock ended less than a window ago
        let later = t0 + FAILURE_WINDOW;
        assert!(throttle.begin_attempt("u3", later).is_some());
        assert_eq!(throttle.len(), 2);
        assert!(!throttle.accounts.lock().unwrap().contains_key("u1"));
    }

    #[test]
    fn a_correct_password_on_the_locking_attempt_clears_it() {
        let throttle = LoginThrottle::new();
        let now = fail_times(&throttle, "u1", Instant::now(), MAX_FAILURES - 1);
        assert_eq!(throttle.begin_attempt("u1", now), Some(Some(FIRST_LOCK)));
        throttle.record_success("u1");
        assert!(!throttle.is_locked("u1", now));
        assert_eq!(throttle.len(), 0);
    }
}
