[Documentation](../../docs/README.md#run-a-server)

# Optional LAN monitoring

Monitor Caimack from a Windows PC on the same LAN. The PC runs Grafana,
Prometheus, and Blackbox Exporter. Node Exporter runs on the Linux server.
The monitoring stack uses separate Compose projects.

## Configure the monitoring PC

Install Docker Desktop and clone Caimack on the Windows PC. Compose must
support [`configs.content`](https://docs.docker.com/reference/compose-file/configs/).
Copy [`.env.example`](.env.example) to `deploy/monitoring/.env` and fill in the
connection settings.

| Setting | Value |
| --- | --- |
| `CAIMACK_MONITORING_LAN_IP` | LAN address of the Linux server. |
| `CAIMACK_MONITORING_DOMAIN` | Hostname on Caimack's HTTPS certificate. |
| `CAIMACK_MONITORING_SSH_TARGET` | SSH destination, such as `user@192.168.1.10`. |
| `GRAFANA_ADMIN_PASSWORD` | Initial Grafana admin password. |
| `GRAFANA_LOCAL_PORT` | Local dashboard port, `3030` by default. |

Connect to the server over SSH once to verify and save its host key. The SSH
account needs key authentication, Docker access, and local TCP forwarding.

## Turn monitoring on or off from Windows

From the repository root in Git Bash, use the manager:

```bash
./caimack.sh monitoring on
./caimack.sh monitoring status
./caimack.sh monitoring off
```

From PowerShell, use `.\deploy\monitoring\monitoring.ps1 on` and substitute
`status` or `off` as needed.

`on` starts the exporter over SSH, enables the Windows task that maintains the
tunnel, and starts the local stack. `off` stops both stacks and disables the
task. Grafana settings and Prometheus history are retained.

## Open the dashboard

Open `http://127.0.0.1:3030` with the configured `GRAFANA_LOCAL_PORT` if you
changed it. Sign in as `admin` with the password from `.env`.
**Caimack Server** shows availability, HTTPS response time, CPU use,
available memory, and free disk space. Prometheus retains up to 30 days of
history. The HTTPS check connects to the configured LAN IP and validates the
certificate for the hostname.

**Alerting → Alert rules** shows availability and resource alerts. To deliver notifications, add a contact point and configure the notification policy in Grafana. Collection and alert evaluation require this computer and Docker to be running.

## Manage just the exporter on Linux

On the Linux server, `./caimack.sh monitoring on`, `status`, and `off` manage Node Exporter. The server console also has a monitoring exporter toggle (`n`). The exporter listens on `127.0.0.1:19100`. To manage the Windows stack and its SSH task as well, run the command from Windows.
