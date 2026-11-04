#!/bin/sh
# Invoked by a running KMServer.app after its replacement has been downloaded.
# The staged app lives beside the installed app, so rename is atomic on one volume.
set -eu

old_pid="$1"
app="$2"
staged="$3"
log="$4"
config_dir="$5"
port="$6"
backup="${app}.update-backup"
work="${app}.update-work"

launch_and_check() {
	"$app/Contents/MacOS/kmrs" --config-dir "$config_dir" &
	new_pid=$!
	waited=0
	while [ "$waited" -lt 30 ]; do
		kill -0 "$new_pid" 2>/dev/null || {
			wait "$new_pid" || true
			return 1
		}
		if curl -fsS "http://127.0.0.1:$port/actuator/health" 2>/dev/null | grep -q '"status"[[:space:]]*:[[:space:]]*"UP"'; then
			return 0
		fi
		sleep 1
		waited=$((waited + 1))
	done
	kill "$new_pid" 2>/dev/null || true
	wait "$new_pid" || true
	return 1
}

restore_running_app() {
	if [ -n "${new_pid:-}" ]; then
		kill "$new_pid" 2>/dev/null || true
		wait "$new_pid" 2>/dev/null || true
	fi
	if [ -d "$backup" ]; then
		rm -rf "$app"
		mv "$backup" "$app"
	fi
	launch_and_check
}

exec >>"$log" 2>&1
printf 'Waiting for KMServer pid %s to exit\n' "$old_pid"
waited=0
while kill -0 "$old_pid" 2>/dev/null; do
	sleep 1
	waited=$((waited + 1))
	if [ "$waited" -ge 90 ]; then
		printf 'KMServer did not stop in time; the installed app is unchanged\n'
		open "$app" --args --config-dir "$config_dir" || true
		exit 1
	fi
done

[ -d "$app" ] || {
	restore_running_app
	exit 1
}
[ -d "$staged/KMServer.app" ] || {
	restore_running_app
	exit 1
}
[ ! -e "$backup" ] || {
	restore_running_app
	exit 1
}
[ ! -e "$work" ] || {
	restore_running_app
	exit 1
}
codesign --verify --deep --strict "$staged/KMServer.app" || {
	restore_running_app
	exit 1
}
spctl --assess --type execute "$staged/KMServer.app" || {
	restore_running_app
	exit 1
}
ditto "$staged/KMServer.app" "$work" || {
	restore_running_app
	exit 1
}

if ! mv "$app" "$backup"; then
	printf 'Could not preserve the installed app\n'
	restore_running_app
	exit 1
fi
if mv "$work" "$app"; then
	if launch_and_check; then
		rm -rf "$backup"
		printf 'Update installed\n'
		exit 0
	fi
	printf 'New app could not launch; restoring the previous version\n'
else
	printf 'New app could not be installed; restoring the previous version\n'
fi
restore_running_app
