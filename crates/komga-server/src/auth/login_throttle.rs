//! Failed password logins per account and client address. After `MAX_FAILURES` failures in
//! a row from one address (none more than `FAILURE_WINDOW` apart, counted from the end of a
//! lock) that address is refused password logins for the account for a while: one minute at
//! first, doubling with every further failure up to `MAX_LOCK`. A successful login from the
//! address clears its count.
//!
//! - Keyed by user id and client address, so a lock only hits the source that is guessing:
//!   the user's other devices keep signing in, and knowing an email is not enough to lock
//!   its owner out. The address is the one `http::client_addr` resolves, which takes
//!   `X-Forwarded-For` from trusted proxies only. Clients that reach the server through one
//!   shared address, such as a proxy that is not listed, share a key.
//! - Only existing accounts are counted, so guessing made-up emails cannot grow the map.
//! - Only password (Basic) logins are refused. Sessions, API keys and remember-me cookies
//!   keep working, so devices that are already signed in are not affected.
//! - An attempt counts when it starts, under the same lock as the check, so concurrent
//!   guesses cannot all slip past it; a correct password then clears the count.
//! - A refused attempt answers like a wrong password without checking it, and does not
//!   extend the lock: retrying while locked never makes the wait longer. The lock only
//!   grows when an attempt after it ends starts.

use std::collections::HashMap;
use std::net::IpAddr;
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

/// An account as seen from one client address. The address is `None` only when the
/// connection's own address is unknown.
type Source = (String, Option<IpAddr>);

#[derive(Default)]
pub struct LoginThrottle {
    sources: Mutex<HashMap<Source, Failures>>,
}

impl LoginThrottle {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts a password attempt for the account from the client address, counted as a
    /// failure until `record_success`. `None` while that source is locked; otherwise the
    /// lock this attempt starts, if any, which holds unless the attempt succeeds.
    pub fn begin_attempt(
        &self,
        user_id: &str,
        client: Option<IpAddr>,
        now: Instant,
    ) -> Option<Option<Duration>> {
        let source: Source = (user_id.to_string(), client);
        let mut sources = self.sources.lock().unwrap();
        if sources
            .get(&source)
            .and_then(|failures| failures.locked_until)
            .is_some_and(|until| until > now)
        {
            return None;
        }
        if !sources.contains_key(&source) {
            // a new key is the only way the map grows: drop the entries that are done
            sources.retain(|_, failures| failures.is_live(now));
        }
        let failures = sources.entry(source).or_insert_with(|| Failures {
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

    /// A successful password login clears the failures of that account and address.
    pub fn record_success(&self, user_id: &str, client: Option<IpAddr>) {
        self.sources
            .lock()
            .unwrap()
            .remove(&(user_id.to_string(), client));
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.sources.lock().unwrap().len()
    }

    /// Whether that source is refused right now, without counting anything.
    pub fn is_locked(&self, user_id: &str, client: Option<IpAddr>, now: Instant) -> bool {
        self.sources
            .lock()
            .unwrap()
            .get(&(user_id.to_string(), client))
            .and_then(|failures| failures.locked_until)
            .is_some_and(|until| until > now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two client addresses.
    const A: Option<IpAddr> = Some(IpAddr::V4(std::net::Ipv4Addr::new(192, 0, 2, 1)));
    const B: Option<IpAddr> = Some(IpAddr::V4(std::net::Ipv4Addr::new(192, 0, 2, 2)));

    fn fail_times(throttle: &LoginThrottle, user_id: &str, start: Instant, n: u32) -> Instant {
        let mut now = start;
        for _ in 0..n {
            assert!(throttle.begin_attempt(user_id, A, now).is_some());
            now += Duration::from_secs(1);
        }
        now
    }

    #[test]
    fn locks_after_max_failures_for_one_minute() {
        let throttle = LoginThrottle::new();
        let t0 = Instant::now();
        let after_four = fail_times(&throttle, "u1", t0, MAX_FAILURES - 1);
        assert!(!throttle.is_locked("u1", A, after_four));

        assert_eq!(
            throttle.begin_attempt("u1", A, after_four),
            Some(Some(FIRST_LOCK))
        );
        assert!(throttle.is_locked("u1", A, after_four));
        // further attempts are refused, also concurrent ones that start now
        assert_eq!(throttle.begin_attempt("u1", A, after_four), None);
        assert!(throttle.is_locked("u1", A, after_four + Duration::from_secs(59)));
        assert!(!throttle.is_locked("u1", A, after_four + FIRST_LOCK));
        // other accounts are unaffected
        assert!(!throttle.is_locked("u2", A, after_four));
    }

    #[test]
    fn a_lock_holds_for_one_address_only() {
        let throttle = LoginThrottle::new();
        let now = fail_times(&throttle, "u1", Instant::now(), MAX_FAILURES);
        assert!(throttle.is_locked("u1", A, now));
        // the same account from another address is neither locked nor counted so far
        assert!(!throttle.is_locked("u1", B, now));
        assert_eq!(throttle.begin_attempt("u1", B, now), Some(None));
        // a success from the other address leaves the first one locked
        throttle.record_success("u1", B);
        assert!(throttle.is_locked("u1", A, now));
        // an unknown address is a source of its own
        assert_eq!(throttle.begin_attempt("u1", None, now), Some(None));
        assert!(throttle.is_locked("u1", A, now));
    }

    #[test]
    fn each_further_failure_doubles_the_lock_up_to_the_cap() {
        let throttle = LoginThrottle::new();
        let mut now = fail_times(&throttle, "u1", Instant::now(), MAX_FAILURES);
        let mut expected = FIRST_LOCK;
        for _ in 0..6 {
            now += expected; // the lock has just run out
            expected = (expected * 2).min(MAX_LOCK);
            assert_eq!(throttle.begin_attempt("u1", A, now), Some(Some(expected)));
            assert!(throttle.is_locked("u1", A, now + expected - Duration::from_secs(1)));
            assert!(!throttle.is_locked("u1", A, now + expected));
        }
        assert_eq!(expected, MAX_LOCK);
    }

    #[test]
    fn success_and_quiet_periods_reset_the_count() {
        let throttle = LoginThrottle::new();
        let t0 = Instant::now();
        let now = fail_times(&throttle, "u1", t0, MAX_FAILURES - 1);
        throttle.record_success("u1", A);
        let now = fail_times(&throttle, "u1", now, MAX_FAILURES - 1);
        assert!(!throttle.is_locked("u1", A, now));

        // failures further apart than the window start over
        let later = now + FAILURE_WINDOW;
        assert_eq!(throttle.begin_attempt("u1", A, later), Some(None));
        assert!(!throttle.is_locked("u1", A, later));
    }

    #[test]
    fn finished_entries_are_dropped_when_a_new_source_fails() {
        let throttle = LoginThrottle::new();
        let t0 = Instant::now();
        assert!(throttle.begin_attempt("u1", A, t0).is_some());
        fail_times(&throttle, "u2", t0, MAX_FAILURES);
        assert_eq!(throttle.len(), 2);

        // u1's single failure is past the window; u2's lock ended less than a window ago
        let later = t0 + FAILURE_WINDOW;
        assert!(throttle.begin_attempt("u3", A, later).is_some());
        assert_eq!(throttle.len(), 2);
        assert!(!throttle
            .sources
            .lock()
            .unwrap()
            .contains_key(&("u1".to_string(), A)));
    }

    #[test]
    fn a_correct_password_on_the_locking_attempt_clears_it() {
        let throttle = LoginThrottle::new();
        let now = fail_times(&throttle, "u1", Instant::now(), MAX_FAILURES - 1);
        assert_eq!(throttle.begin_attempt("u1", A, now), Some(Some(FIRST_LOCK)));
        throttle.record_success("u1", A);
        assert!(!throttle.is_locked("u1", A, now));
        assert_eq!(throttle.len(), 0);
    }
}
