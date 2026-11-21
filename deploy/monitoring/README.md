# Optional LAN monitoring

Run Grafana, Prometheus, and Blackbox Exporter on a Windows computer on the same LAN as Caimack. Node Exporter runs on the Linux server. Monitoring is opt-in and runs in separate Compose projects.

## Turn monitoring on or off from Windows

Install Docker Desktop and use a Caimack repository checkout on the Windows computer. Docker Compose must support [`configs.content`](https://docs.docker.com/reference/compose-file/configs/). From `deploy/monitoring`, copy `.env.example` to `.env` and set the server's LAN IP, Caimack's HTTPS hostname, the SSH destination, and an initial Grafana admin password.

Connect to the Linux server with SSH once to verify and save its host key. The SSH account needs key authentication, access to Docker, and permission to forward local TCP connections. From the repository root in Git Bash, run:

```bash
./caimack.sh monitoring on
./caimack.sh monitoring status
./caimack.sh monitoring off
```

From PowerShell, use `.\deploy\monitoring\monitoring.ps1 on`, `status`, or `off`. The `on` command starts the exporter over SSH, enables the Windows task that keeps the SSH tunnel running, and starts the local stack. The `off` command stops both stacks and disables the SSH task. Grafana's settings and Prometheus history are preserved.

## Open the dashboard

Open `http://127.0.0.1:3030` and sign in as `admin` with the password from `.env`. **Caimack Server** shows availability history, HTTPS response time, CPU usage, available memory, and free disk space. Prometheus keeps up to 30 days of history. The HTTPS check connects directly to the configured LAN IP and validates the certificate for the hostname.

**Alerting → Alert rules** shows availability and resource alerts. To deliver notifications, add a contact point and configure the notification policy in Grafana. Collection and alert evaluation require this computer and Docker to be running.

## Manage just the exporter on Linux

On the Linux server, `./caimack.sh monitoring on`, `status`, and `off` manage Node Exporter. The server console also has a monitoring exporter toggle (`n`). The exporter listens on `127.0.0.1:19100`. To manage the Windows stack and its SSH task as well, run the command from Windows.
