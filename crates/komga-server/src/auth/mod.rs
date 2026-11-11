//! Authentication resolution and middleware: tries X-API-Key → Basic → X-Auth-Token/session cookie → remember-me, in that order.
//! Aligned with `SecurityConfiguration.kt`: successful Basic/remember-me authentication establishes a session (IF_REQUIRED);
//! any authenticated request with a `remember-me=true` parameter → issue a remember-me cookie.
//! API-key authentication is stateless like 1.29's `ApiKeyAuthenticationFilter` (request-scoped
//! `SecurityContext`, no session persistence): every request re-authenticates and no session
//! cookie/token is issued; successful activity rows are throttled per key
//! (`ApiKeyActivityThrottle`). `/koreader/**` also accepts the KOReader sync header
//! `X-Auth-User` (the kosync filter chain's converter).

pub mod login_throttle;
pub mod password_cache;
pub mod remember_me;
pub mod session;

use crate::state::AppState;
use axum::extract::{Request, State};
use axum::http::request::Parts;
use axum::middleware::Next;
use axum::response::Response;
use komga_core::model::user::{KomgaUser, UserRole};
use komga_db::dao::user::UserDao;
use sha2::{Digest, Sha512};

pub use session::{SessionStore, SESSION_COOKIE_NAME, SESSION_HEADER_NAME};

/// One successful API-key activity row per key per window: upstream komga writes a row for
/// every API-key request, which floods the login-activity view for stateless clients that
/// send their key on each one. Successful password logins get the same window per user and
/// device (IP and user agent), for clients that send Basic on every request without the
/// session. Failures stay per-request — they are the brute-force signal.
const API_KEY_ACTIVITY_WINDOW: std::time::Duration = std::time::Duration::from_secs(3600);

/// LoginListener's source label for API-key authentications; persisted in
/// AUTHENTICATION_ACTIVITY, it must stay the Java value.
pub(crate) const SOURCE_API_KEY: &str = "ApiKey";

/// LoginListener's source label for password (Basic) authentications.
pub(crate) const SOURCE_PASSWORD: &str = "Password";

pub struct ApiKeyActivityThrottle {
    window: std::time::Duration,
    last: std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>,
}

impl ApiKeyActivityThrottle {
    pub(crate) fn new() -> Self {
        Self {
            window: API_KEY_ACTIVITY_WINDOW,
            last: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }

    /// True when this success should be recorded: first sighting of the key, or the
    /// previous record is older than the throttle window. Recording drops the keys whose
    /// window has passed: password keys include the IP and user agent, so without that
    /// the map would only grow.
    pub(crate) fn should_record(&self, key: &str, now: std::time::Instant) -> bool {
        let mut last = self.last.lock().unwrap();
        if let Some(&t) = last.get(key) {
            if now.saturating_duration_since(t) < self.window {
                return false;
            }
        }
        last.retain(|_, &mut t| now.saturating_duration_since(t) < self.window);
        last.insert(key.to_string(), now);
        true
    }

    #[cfg(test)]
    pub(crate) fn expire(&self, api_key_id: &str) {
        self.last.lock().unwrap().remove(api_key_id);
    }
}

impl Default for ApiKeyActivityThrottle {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthSource {
    Password,
    ApiKey,
    RememberMe,
    Session,
}

#[derive(Debug, Clone)]
pub struct Auth {
    pub user: KomgaUser,
    #[allow(dead_code)] // used by OPDS/Kobo/KOReader in M3+
    pub source: AuthSource,
    #[allow(dead_code)]
    pub api_key_id: Option<String>,
    /// The session the request authenticated with; lets endpoints mark the caller's own session.
    pub session_id: Option<String>,
}

impl Auth {
    pub fn is_admin(&self) -> bool {
        self.user.is_admin()
    }

    pub fn require_admin(&self) -> Result<(), crate::error::ApiError> {
        if self.is_admin() {
            Ok(())
        } else {
            Err(crate::error::ApiError::forbidden(""))
        }
    }

    #[allow(dead_code)] // used by endpoints starting from M3
    pub fn require_role(&self, role: UserRole) -> Result<(), crate::error::ApiError> {
        if self.user.roles.contains(&role) || self.is_admin() {
            Ok(())
        } else {
            Err(crate::error::ApiError::forbidden(""))
        }
    }
}

pub fn sha512_hex(input: &str) -> String {
    hex::encode(Sha512::digest(input.as_bytes()))
}

pub struct ActivityDraft {
    pub user_id: Option<String>,
    pub email: Option<String>,
    pub api_key_id: Option<String>,
    pub api_key_comment: Option<String>,
    pub success: bool,
    pub error: Option<String>,
    pub source: String,
}

/// Authentication resolution result stored in request extensions.
#[derive(Clone)]
pub(crate) struct ResolvedAuth {
    pub auth: Option<Auth>,
}

fn parse_basic_authorization(value: &str) -> Option<(String, String)> {
    use base64::Engine;
    let encoded = value.strip_prefix("Basic ")?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .ok()?;
    let decoded = String::from_utf8(decoded).ok()?;
    let (email, password) = decoded.split_once(':')?;
    Some((email.to_string(), password.to_string()))
}

struct Outcome {
    auth: Option<Auth>,
    new_session_id: Option<String>,
    activity: Option<ActivityDraft>,
}

/// How long a password check waits for a free permit before the request is told to retry.
const PASSWORD_CHECK_WAIT: std::time::Duration = std::time::Duration::from_secs(2);

/// The permits for concurrent password checks: half the available cores, at least one, so
/// a flood of logins leaves CPU for the other requests.
pub fn password_check_permits() -> std::sync::Arc<tokio::sync::Semaphore> {
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    std::sync::Arc::new(tokio::sync::Semaphore::new((cores / 2).max(1)))
}

/// Every permit stayed taken for `PASSWORD_CHECK_WAIT`: the password was not checked.
struct PasswordChecksBusy;

/// Reports saturated password checks without writing a line per request: one line when
/// requests start being told to retry, and one with their number a minute later. A flood
/// of logins therefore adds two lines a minute to the log.
fn report_busy_password_checks() {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    const INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);
    static TOLD_TO_RETRY: AtomicU64 = AtomicU64::new(0);
    static REPORTING: AtomicBool = AtomicBool::new(false);

    TOLD_TO_RETRY.fetch_add(1, Ordering::Relaxed);
    if !REPORTING.swap(true, Ordering::AcqRel) {
        tracing::warn!(
            "password checks are saturated: logins that cannot start within {}s are answered 503",
            PASSWORD_CHECK_WAIT.as_secs()
        );
        tokio::spawn(async {
            tokio::time::sleep(INTERVAL).await;
            let told_to_retry = TOLD_TO_RETRY.swap(0, Ordering::Relaxed);
            REPORTING.store(false, Ordering::Release);
            tracing::warn!(
                "{told_to_retry} login request(s) were answered 503 in the last {}s",
                INTERVAL.as_secs()
            );
        });
    }
}

/// How a password check ended.
enum PasswordCheck {
    /// the source got locked while the request waited for its permit
    Refused,
    Verified,
    /// with the lock this failure started, if it started one
    Failed(Option<std::time::Duration>),
}

fn failed_password_outcome(user_id: Option<String>, email: String, error: &str) -> Outcome {
    Outcome {
        auth: None,
        new_session_id: None,
        activity: Some(ActivityDraft {
            user_id,
            email: Some(email),
            api_key_id: None,
            api_key_comment: None,
            success: false,
            error: Some(error.into()),
            source: SOURCE_PASSWORD.into(),
        }),
    }
}

/// A password login that succeeded, by a check or by the cache of successful checks.
fn verified_password_outcome(state: &AppState, user: KomgaUser) -> Outcome {
    let activity = ActivityDraft {
        user_id: Some(user.id.clone()),
        email: Some(user.email.clone()),
        api_key_id: None,
        api_key_comment: None,
        success: true,
        error: None,
        source: SOURCE_PASSWORD.into(),
    };
    Outcome {
        // a broken session store must not fail the authentication itself
        new_session_id: state
            .sessions
            .create(&user.id)
            .map_err(|e| tracing::warn!("failed to persist session, continuing without one: {e}"))
            .ok(),
        auth: Some(Auth {
            user,
            source: AuthSource::Password,
            api_key_id: None,
            session_id: None,
        }),
        activity: Some(activity),
    }
}

/// The session's user when it is the one the Basic credentials name, so Basic can skip
/// re-authentication like Spring's `BasicAuthenticationFilter.authenticationIsRequired`.
/// The email compares the way the login lookup does (ASCII case-insensitive).
fn session_matching_basic(
    state: &AppState,
    user_dao: &UserDao,
    session_id: &str,
    email: &str,
) -> Option<KomgaUser> {
    let session = state
        .sessions
        .get(session_id)
        .map_err(|e| tracing::warn!("failed to load session {session_id}: {e}"))
        .ok()
        .flatten()?;
    user_dao
        .find_by_id(&session.user_id)
        .ok()
        .flatten()
        .filter(|user| user.email.eq_ignore_ascii_case(email))
}

async fn resolve(
    state: &AppState,
    parts: &Parts,
    session_id: Option<&str>,
) -> Result<Outcome, PasswordChecksBusy> {
    let headers = &parts.headers;
    let user_dao = UserDao::new(state.db.clone());

    // 1. X-API-Key (X-Auth-User on /koreader/**, the KOReader sync chain's header)
    let api_key_header = if parts.uri.path().starts_with("/koreader/") {
        headers
            .get("X-Auth-User")
            .or_else(|| headers.get("X-API-Key"))
    } else {
        headers.get("X-API-Key")
    };
    if let Some(key) = api_key_header.and_then(|v| v.to_str().ok()) {
        // sha512 is the DB lookup hash (Java's TokenEncoder credentials); the XXH3-128 masked hash
        // is the token's principal name (Java's Hasher), used for the failure activity
        let hashed = sha512_hex(key.trim());
        let masked = komga_media::hash::compute_hash_bytes(key.trim().as_bytes());
        return Ok(match user_dao.find_by_api_key(&hashed) {
            Ok(Some((user, api_key))) => {
                // LoginListener records user.id/user.email on success; nulls are for failures.
                // The context is request-scoped (1.29), so every request re-authenticates; no
                // session is created or marked. Successful rows are throttled per key at
                // recording time, failures stay per-request.
                let activity = ActivityDraft {
                    user_id: Some(api_key.user_id.clone()),
                    email: Some(user.email.clone()),
                    api_key_id: Some(api_key.id.clone()),
                    api_key_comment: Some(api_key.comment),
                    success: true,
                    error: None,
                    source: SOURCE_API_KEY.into(),
                };
                Outcome {
                    auth: Some(Auth {
                        user: user.clone(),
                        source: AuthSource::ApiKey,
                        api_key_id: Some(api_key.id.clone()),
                        session_id: None,
                    }),
                    new_session_id: None,
                    activity: Some(activity),
                }
            }
            _ => Outcome {
                auth: None,
                new_session_id: None,
                activity: Some(ActivityDraft {
                    user_id: None,
                    email: None,
                    api_key_id: None,
                    // LoginListener.onFailure stores the masked key as apiKeyComment
                    api_key_comment: Some(masked),
                    success: false,
                    error: Some("Bad credentials".into()),
                    source: SOURCE_API_KEY.into(),
                }),
            },
        });
    }

    // 2. Basic
    if let Some(value) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        if let Some((email, password)) = parse_basic_authorization(value) {
            // a client that sends its session back with Basic keeps that session: no new
            // session, no bcrypt run and no activity row, as for a plain session request
            if let Some((session_id, user)) = session_id.and_then(|id| {
                session_matching_basic(state, &user_dao, id, &email)
                    .map(|user| (id.to_string(), user))
            }) {
                return Ok(Outcome {
                    auth: Some(Auth {
                        user,
                        source: AuthSource::Session,
                        api_key_id: None,
                        session_id: Some(session_id),
                    }),
                    new_session_id: None,
                    activity: None,
                });
            }
            let Some(account) = user_dao.find_by_email_ignore_case(&email).ok().flatten() else {
                // an unknown email is neither checked nor counted
                return Ok(failed_password_outcome(None, email, "Bad credentials"));
            };
            // failures are counted per account and client address, so a lock only hits
            // the source that is guessing
            let client = crate::http::client_addr::client_ip(parts, &state.config.trusted_proxies);
            // the account is known here, so the refusal shows up in its login activity
            // whatever spelling of the email was sent
            let refused = |email: String| {
                failed_password_outcome(Some(account.id.clone()), email, "Too many failed attempts")
            };
            // a locked source answers like a wrong password, without waiting for a check
            if state
                .login_throttle
                .is_locked(&account.id, client, std::time::Instant::now())
            {
                return Ok(refused(email));
            }
            // the same password was checked for this account and address a moment ago: it
            // is served without a check, and otherwise like a check that succeeded. Only
            // sources that are not locked get here.
            let cache_key =
                state
                    .password_cache
                    .key(&account.id, &account.password, client, &password);
            let checked_before = || {
                let hit = state.password_cache.contains(&cache_key);
                if hit {
                    state.login_throttle.record_success(&account.id, client);
                }
                hit
            };
            if checked_before() {
                return Ok(verified_password_outcome(state, account));
            }
            // the checks are CPU-bound: only so many run at a time, the others wait their
            // turn, and a request that cannot start within the wait is told to retry
            let permits = state.password_checks.clone();
            let Ok(Ok(permit)) =
                tokio::time::timeout(PASSWORD_CHECK_WAIT, permits.acquire_owned()).await
            else {
                return Err(PasswordChecksBusy);
            };
            // asked again now that the wait is over: requests that arrive together all
            // miss the cache, and all but the first find its result here
            if checked_before() {
                return Ok(verified_password_outcome(state, account));
            }
            // off the async workers, and as one task that runs to its end even when the
            // client goes away meanwhile: a check that started always reports its result
            // to the throttle and only then gives the permit back
            let (throttle, cache) = (state.login_throttle.clone(), state.password_cache.clone());
            let (user_id, hash) = (account.id.clone(), account.password.clone());
            let check = tokio::task::spawn_blocking(move || {
                let _permit = permit;
                // asked again now that the check is about to run: of the requests that
                // were waiting when a lock started, none is checked any more
                if throttle.is_locked(&user_id, client, std::time::Instant::now()) {
                    return PasswordCheck::Refused;
                }
                if bcrypt::verify(&password, &hash).unwrap_or(false) {
                    cache.insert(cache_key, &user_id);
                    throttle.record_success(&user_id, client);
                    PasswordCheck::Verified
                } else {
                    // a failure counts only now that the check has failed
                    PasswordCheck::Failed(throttle.record_failure(
                        &user_id,
                        client,
                        std::time::Instant::now(),
                    ))
                }
            })
            .await
            .unwrap_or_else(|e| {
                tracing::error!("password check for {email:?} did not finish: {e}");
                PasswordCheck::Failed(None)
            });
            return Ok(match check {
                PasswordCheck::Refused => refused(email),
                PasswordCheck::Failed(lock_started) => {
                    if let Some(lock) = lock_started {
                        tracing::warn!(
                            "password logins for {email:?} from {} refused for {}s after repeated failures",
                            client.map_or_else(|| "an unknown address".to_string(), |ip| ip.to_string()),
                            lock.as_secs()
                        );
                    }
                    failed_password_outcome(None, email, "Bad credentials")
                }
                PasswordCheck::Verified => verified_password_outcome(state, account),
            });
        }
    }

    Ok(Outcome {
        auth: None,
        new_session_id: None,
        activity: None,
    })
}

async fn resolve_session_and_remember(
    state: &AppState,
    parts: &Parts,
    session_id: Option<String>,
) -> Outcome {
    let user_dao = UserDao::new(state.db.clone());

    // 3. session (X-Auth-Token header takes precedence over cookie)
    if let Some(session_id) = session_id {
        // a store error reads as no session: the request falls through to the
        // remaining auth methods (fail-closed)
        match state.sessions.get(&session_id) {
            Ok(Some(session)) => {
                if let Ok(Some(user)) = user_dao.find_by_id(&session.user_id) {
                    return Outcome {
                        auth: Some(Auth {
                            user,
                            source: AuthSource::Session,
                            api_key_id: None,
                            session_id: Some(session_id),
                        }),
                        new_session_id: None,
                        activity: None,
                    };
                }
            }
            Ok(None) => {}
            Err(e) => tracing::warn!("failed to load session {session_id}: {e}"),
        }
    }

    // 4. remember-me cookie
    if let Some(token) = cookie_value(parts, remember_me::REMEMBER_ME_COOKIE) {
        let now_millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        if let Ok(Some(key)) = state.settings.get_setting("REMEMBER_ME_KEY") {
            if let Some(parsed) = remember_me::parse_token(&token) {
                if let Ok(Some(user)) = user_dao.find_by_email_ignore_case(&parsed.email) {
                    if remember_me::verify(&parsed, &user, &key, now_millis) {
                        let activity = ActivityDraft {
                            user_id: Some(user.id.clone()),
                            email: Some(user.email.clone()),
                            api_key_id: None,
                            api_key_comment: None,
                            success: true,
                            error: None,
                            source: "RememberMe".into(),
                        };
                        return Outcome {
                            new_session_id: state
                                .sessions
                                .create(&user.id)
                                .map_err(|e| {
                                    tracing::warn!(
                                        "failed to persist session, continuing without one: {e}"
                                    )
                                })
                                .ok(),
                            auth: Some(Auth {
                                user,
                                source: AuthSource::RememberMe,
                                api_key_id: None,
                                session_id: None,
                            }),
                            activity: Some(activity),
                        };
                    }
                }
            }
        }
    }

    Outcome {
        auth: None,
        new_session_id: None,
        activity: None,
    }
}

pub(crate) fn cookie_value(parts: &Parts, name: &str) -> Option<String> {
    let header = parts.headers.get(axum::http::header::COOKIE)?;
    let header = header.to_str().ok()?;
    for pair in header.split(';') {
        let pair = pair.trim();
        if let Some((k, v)) = pair.split_once('=') {
            if k == name {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// Per-request authentication middleware: resolve identity → store in extensions → record authentication activity → attach session/remember-me to the response.
pub async fn auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();
    let session_header = parts
        .headers
        .get(SESSION_HEADER_NAME)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let session_cookie = cookie_value(&parts, SESSION_COOKIE_NAME);
    let session_via_header = session_header.is_some();

    let session_id = session_header.or(session_cookie);

    let mut outcome = match resolve(&state, &parts, session_id.as_deref()).await {
        Ok(outcome) => outcome,
        // the limit is server-wide, not this client's, hence 503 and not 429
        Err(PasswordChecksBusy) => {
            report_busy_password_checks();
            return Response::builder()
                .status(axum::http::StatusCode::SERVICE_UNAVAILABLE)
                .header(axum::http::header::RETRY_AFTER, "1")
                // reported above, once per interval: not a failure for the request trace
                .extension(crate::http::request_trace::DeliberateRefusal)
                .body(axum::body::Body::empty())
                .unwrap();
        }
    };
    if outcome.auth.is_none() && outcome.activity.is_none() {
        outcome = resolve_session_and_remember(&state, &parts, session_id.clone()).await;
    }

    state.record_activity(&outcome.activity, &parts).await;

    let issue_remember_me = outcome.auth.is_some()
        && crate::http::pagination::QueryExt::first(
            &crate::http::pagination::parse_query_multi(parts.uri.query().unwrap_or("")),
            remember_me::REMEMBER_ME_PARAM,
        )
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    // the remember-me cookie is built on the request side first (needs the user and settings)
    let remember_me_cookie = if issue_remember_me {
        outcome.auth.as_ref().map(|auth| {
            let settings = state.settings.get();
            let expiry = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
                + settings.remember_me_duration.as_millis() as u64;
            let token = remember_me::encode_token(&auth.user, &settings.remember_me_key, expiry);
            format!(
                "{}={}; Path=/; Max-Age={}; HttpOnly; SameSite=Lax",
                remember_me::REMEMBER_ME_COOKIE,
                token,
                settings.remember_me_duration.as_secs(),
            )
        })
    } else {
        None
    };

    let new_session_id = outcome.new_session_id.clone();
    parts.extensions.insert(ResolvedAuth { auth: outcome.auth });

    let request = Request::from_parts(parts, body);
    let mut response = next.run(request).await;

    // session transport matches the request: if it came via X-Auth-Token → write the header, otherwise write the cookie
    if let Some(session_id) = new_session_id {
        if session_via_header {
            response.headers_mut().insert(
                axum::http::HeaderName::from_static("x-auth-token"),
                axum::http::HeaderValue::from_str(&session_id).unwrap(),
            );
        } else {
            append_set_cookie(
                &mut response,
                &format!("{SESSION_COOKIE_NAME}={session_id}; Path=/; HttpOnly; SameSite=Lax"),
            );
        }
    }

    if let Some(cookie) = remember_me_cookie {
        append_set_cookie(&mut response, &cookie);
    }

    response
}

pub(crate) fn append_set_cookie(response: &mut Response, cookie: &str) {
    response.headers_mut().append(
        axum::http::header::SET_COOKIE,
        axum::http::HeaderValue::from_str(cookie).unwrap(),
    );
}

/// Extracts the authenticated user; unauthenticated → 401 (empty body + WWW-Authenticate).
pub struct RequireAuth(pub Auth);

impl axum::extract::FromRequestParts<AppState> for RequireAuth {
    type Rejection = crate::error::ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        match parts
            .extensions
            .get::<ResolvedAuth>()
            .and_then(|r| r.auth.clone())
        {
            Some(auth) => Ok(RequireAuth(auth)),
            None => Err(crate::error::ApiError::unauthorized()),
        }
    }
}

/// Optional authentication: for anonymous endpoints.
pub struct MaybeAuth(#[allow(dead_code)] pub Option<Auth>);

impl axum::extract::FromRequestParts<AppState> for MaybeAuth {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        Ok(MaybeAuth(
            parts
                .extensions
                .get::<ResolvedAuth>()
                .and_then(|r| r.auth.clone()),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn api_key_activity_throttle_collapses_within_window_per_key() {
        let throttle = ApiKeyActivityThrottle::new();
        let t0 = Instant::now();

        assert!(throttle.should_record("k1", t0));
        assert!(!throttle.should_record("k1", t0 + Duration::from_secs(3599)));
        // keys are throttled independently
        assert!(throttle.should_record("k2", t0 + Duration::from_secs(10)));
        assert!(throttle.should_record("k1", t0 + Duration::from_secs(3600)));
    }

    #[test]
    fn activity_throttle_drops_keys_past_the_window() {
        let throttle = ApiKeyActivityThrottle::new();
        let t0 = Instant::now();

        assert!(throttle.should_record("password:u1:10.0.0.1:reader", t0));
        assert!(throttle.should_record("password:u1:10.0.0.2:reader", t0 + Duration::from_secs(10)));
        assert!(throttle.should_record("k1", t0 + Duration::from_secs(3605)));
        // only the key recorded within the window is still tracked
        let last = throttle.last.lock().unwrap();
        assert_eq!(last.len(), 2);
        assert!(!last.contains_key("password:u1:10.0.0.1:reader"));
    }

    #[test]
    fn api_key_activity_throttle_expire_forgets_the_key() {
        let throttle = ApiKeyActivityThrottle::new();
        let t0 = Instant::now();

        assert!(throttle.should_record("k1", t0));
        throttle.expire("k1");
        assert!(throttle.should_record("k1", t0 + Duration::from_secs(1)));
    }
}
