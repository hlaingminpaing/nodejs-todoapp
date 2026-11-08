# To-Do App + Amazon RDS for PostgreSQL

The app now stores todos in **PostgreSQL** instead of an in-memory array, so data survives restarts and deployments and is
shared by every ECS task. This guide covers:

1. [Run locally with Docker Compose](#1-run-locally-with-docker-compose)
2. [Create the RDS database and connect the ECS service (AWS Console)](#2-amazon-rds--ecs-aws-console)
3. [Verify, inspect data, costs, clean-up, troubleshooting](#3-verify)

```
Browser ─► ALB ─► ECS service (Fargate tasks, nodejs-todoapp :3000) ──TLS 5432──► RDS PostgreSQL "todo-db"
                         ▲  DB_USER / DB_PASSWORD injected at task start
                         └─ Secrets Manager (secret created and rotated by RDS)
```

## What changed in the code

| File | Change |
|---|---|
| `server.js` | `pg` connection pool; table `todos` created automatically on first start; all routes use parameterised SQL; `/health` (200 only when the DB answers); retries while the DB starts; graceful shutdown on SIGTERM; config from environment variables |
| `package.json` / `package-lock.json` | + `pg`; `npm audit fix` (0 known vulnerabilities) |
| `views/index.ejs`, `public/styles.css` | footer "Served by `<hostname>`" — shows which task answered (same data on every task) |
| `Dockerfile` | `npm ci --omit=dev`, Amazon RDS CA bundle in `/app/certs`, non-root `node` user, health check, `CMD ["node","server.js"]` |
| `.dockerignore`, `.gitignore` | host `node_modules` never copied into the image / not tracked |
| `compose.yaml` | local app + PostgreSQL 18 |
| `task-definition.json` | DB environment variables, `secrets` from Secrets Manager, health check, CloudWatch logs; role ARN uses `$AWS_ACCOUNT_ID` |
| `buildspec.yaml` | `DB_HOST` / `DB_SECRET_ARN` variables + `sed` lines; **fix:** `imagedefinitions.json` used container name `todo-app`, the task definition uses `nodejs-todoapp` |

### Environment variables

| Variable | Local (compose) | ECS / RDS |
|---|---|---|
| `DB_HOST` | `db` | RDS endpoint, e.g. `todo-db.xxxx.ap-southeast-1.rds.amazonaws.com` |
| `DB_PORT` | `5432` | `5432` |
| `DB_NAME` | `todo` | `todo` (the "Initial database name" in step 2.2) |
| `DB_USER` / `DB_PASSWORD` | `todo` / `todo-local-only` | from the RDS-managed secret (`username` / `password` keys) |
| `DB_SSL` | `disable` | `verify-full` (TLS + certificate check with the RDS CA bundle in the image) |
| `DB_POOL_MAX` | 5 | 5 per task |
| `PORT` | 3000 | 3000 |

---

## 1. Run locally with Docker Compose

```powershell
cd D:\Code\nodejs-todoapp
docker compose up -d --build
docker compose ps                       # db healthy, app running
start http://localhost:3000             # add / complete / delete todos
curl.exe http://localhost:3000/health   # {"status":"ok","database":"up",...}
```
Data is persistent:
```powershell
docker compose restart app              # todos are still there
docker compose exec db psql -U todo -d todo -c "SELECT * FROM todos ORDER BY id;"
docker compose down                     # stop (data kept in volume todo-pgdata)
docker compose down -v                  # !!! also deletes the database volume
```
Without Docker for the app (`npm start`), keep the compose database running and point the app at it:
```powershell
docker compose up -d db
npm install
$env:DB_HOST='localhost'; $env:DB_PORT='5433'; $env:DB_NAME='todo'; $env:DB_USER='todo'; $env:DB_PASSWORD='todo-local-only'
npm start
```

---

## 2. Amazon RDS + ECS (AWS Console)

Region: **ap-southeast-1 (Singapore)** in every step. Existing resources from the README: cluster `todo-app-cluster`,
service `todo-web-app-service1`, task family `todo-web-app-task`, role `ecsTaskExecutionRole`.

### 2.1 Find the service's network (you need it for the database)
**ECS → Clusters → todo-app-cluster → Services → todo-web-app-service1 → Configuration and networking**: note the **VPC**,
the **subnets** and the **security group** of the tasks (below: `TASKS-SG`).

### 2.2 Security group for the database
**EC2 → Security Groups → Create security group**
- Name `todo-db-sg`, description `PostgreSQL from the todo ECS tasks`, VPC = the service VPC
- Inbound rule: **PostgreSQL** (TCP 5432), source **Custom** → select **`TASKS-SG`**
- Outbound: default → **Create security group**

Only the app's tasks can reach the database; it gets no public IP.

### 2.3 Create the database
**RDS → Databases → Create database**
- **Standard create** · Engine **PostgreSQL** · Engine version: latest **PostgreSQL 18.x**
- Templates: **Free tier** (if offered for your account) or **Dev/Test** · Availability: **Single-AZ DB instance**
- DB instance identifier: `todo-db`
- Master username: `todoadmin`
- Credentials management: **Managed in AWS Secrets Manager** (default encryption key) — RDS creates and rotates the password; nobody needs to see it
- Instance configuration: **Burstable classes → db.t4g.micro**
- Storage: **gp3, 20 GiB** (storage autoscaling can be turned off for the lab)
- Connectivity:
  - Compute resource: **Don't connect to an EC2 compute resource**
  - VPC: the **service VPC** · DB subnet group: **Create new DB subnet group** (needs subnets in 2 AZs)
  - Public access: **No**
  - VPC security group: **Choose existing** → `todo-db-sg` (remove `default`)
- Database authentication: **Password authentication**
- **Additional configuration** → Initial database name: **`todo`** (required — the app connects to this database) ·
  Backup retention: 1–7 days · Deletion protection: optional
- **Create database** → wait until Status = **Available** (≈ 10–15 min).

Then copy two values from the database page:
- **Connectivity & security → Endpoint** → e.g. `todo-db.abc123xyz.ap-southeast-1.rds.amazonaws.com` (= `DB_HOST`)
- **Configuration → Master credentials ARN** (or **Secrets Manager → Secrets → `rds!db-…` → Secret ARN**) (= `DB_SECRET_ARN`)

RDS for PostgreSQL forces TLS by default (`rds.force_ssl = 1`); the app uses `DB_SSL=verify-full` with the CA bundle baked into the image.

### 2.4 Let ECS read the secret
**IAM → Roles → ecsTaskExecutionRole → Add permissions → Create inline policy → JSON**:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "secretsmanager:GetSecretValue",
    "Resource": "PASTE-DB_SECRET_ARN-HERE"
  }]
}
```
Name it `read-todo-db-secret` → **Create policy**. (The RDS-managed secret uses the AWS-managed key, so no KMS permission is needed.)

### 2.5 Log group for the app logs
**CloudWatch → Log groups → Create log group** → name **`/ecs/todo-web-app`**, retention e.g. 7 days.
(The task definition now sends logs there; the execution role may write to a log group but not create it.)

### 2.6 Network check
The tasks must reach **Secrets Manager** when they start. If they already pull images from ECR (public IP, or private
subnets with a NAT Gateway) nothing is needed. Private subnets *without* NAT need VPC endpoints (`secretsmanager`, `ecr.api`,
`ecr.dkr`, `logs`, S3 gateway).

### 2.7 Deploy the new version
The code changed, so a **new image** is required (it also contains the RDS CA bundle).

**Option A — your CodePipeline (recommended):** edit `buildspec.yaml`:
```yaml
    DB_HOST: "todo-db.abc123xyz.ap-southeast-1.rds.amazonaws.com"      # your endpoint
    DB_SECRET_ARN: "arn:aws:secretsmanager:ap-southeast-1:<acct>:secret:rds!db-...-AbCdEf"   # your secret ARN
```
(Neither value is a secret — the ARN only *points* to the secret.) Commit and push; the pipeline builds the image, fills
`task-definition.json` and registers the new revision.

**Option B — by hand in the console:**
1. Build and push the image (README "Manual Deployment"; use a new tag).
2. **ECS → Task definitions → todo-web-app-task → (latest) → Create new revision** → container `nodejs-todoapp`:
   - Image URI: the new image
   - **Environment variables:** `DB_HOST` = endpoint · `DB_PORT` = `5432` · `DB_NAME` = `todo` · `DB_SSL` = `verify-full`
   - Add two more with type **ValueFrom**: `DB_USER` = `<DB_SECRET_ARN>:username::` · `DB_PASSWORD` = `<DB_SECRET_ARN>:password::`
   - Log collection: CloudWatch, group `/ecs/todo-web-app` · Health check: `CMD-SHELL, wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1`
   - **Create**
3. **Services → todo-web-app-service1 → Update service** → new revision → **Force new deployment** → Update.
   If the service uses the **CodeDeploy (blue/green)** deployment controller, the console won't update it directly —
   deploy through CodeDeploy/the pipeline instead.

Optional but useful: **EC2 → Target groups → (your target group) → Health checks → Edit → path `/health`** — the load balancer
then only sends traffic to tasks that can reach the database.

---

## 3. Verify

1. Open the load balancer URL → add a few todos.
2. `http://<alb-dns>/health` → `{"status":"ok","database":"up","host":"ip-10-..."}`
3. **Survives deployments:** service → **Update service → Force new deployment** → after the new task is running, the todos are still there.
4. **Shared by all tasks:** Update service → Desired tasks **2** → refresh: the footer hostname changes, the list stays the same.
5. Logs: **CloudWatch → Log groups → /ecs/todo-web-app** → `Connected to PostgreSQL database "todo" (PostgreSQL 18.x ...)`.

### Look at the data
RDS is private, so query it from inside the VPC, e.g. **CloudShell → Actions → Create VPC environment** (service VPC, a task
subnet, security group `TASKS-SG` so `todo-db-sg` admits it), then:
```bash
sudo dnf install -y postgresql16     # if psql is missing
PGPASSWORD='<from Secrets Manager → Retrieve secret value>' psql "host=<endpoint> dbname=todo user=todoadmin sslmode=require" -c "SELECT * FROM todos ORDER BY id;"
```

## Cost and clean-up
db.t4g.micro ≈ US$0.02–0.03/hour + 20 GB gp3 storage (Free Tier may cover it), Secrets Manager ≈ US$0.40/month.
- Pause: **RDS → todo-db → Actions → Stop temporarily** (AWS starts it again after 7 days). Scale the service to 0 tasks while it is stopped.
- Remove: **RDS → todo-db → Actions → Delete** (keep a final snapshot if you want the data; untick "Retain automated backups")
  → the RDS-managed secret is deleted with it → delete inline policy `read-todo-db-secret`, security group `todo-db-sg`,
  the DB subnet group, and the log group if no longer needed. Redeploy a task definition without the DB settings only if you
  go back to the old in-memory version.

## Troubleshooting

| Symptom (where) | Cause → fix |
|---|---|
| Task stops: `ResourceInitializationError: unable to pull secrets` (task details) | execution role lacks `secretsmanager:GetSecretValue` on that ARN (2.4), wrong ARN/key in `valueFrom`, or no route to Secrets Manager (2.6) |
| Log: `Missing environment variable DB_HOST` | task definition revision without the DB variables (2.7) |
| Log: `Database not reachable ... timeout` / `ETIMEDOUT` | `todo-db-sg` doesn't allow 5432 from the tasks' security group, or RDS is in another VPC |
| Log: `password authentication failed` | secret ARN of another database, or password rotated after the tasks started → **Force new deployment** (tasks read secrets only at start) |
| Log: `database "todo" does not exist` | "Initial database name" was left empty → create it (CloudShell: `CREATE DATABASE todo;`) or set `DB_NAME=postgres` |
| Log: `unable to verify the first certificate` / `self-signed certificate` | image built before this change (no CA bundle) → rebuild; or set `DB_SSL=require` temporarily |
| Log: `no pg_hba.conf entry ... no encryption` | `DB_SSL=disable` against RDS → use `verify-full` |
| Pipeline deploy fails: container name not found | `imagedefinitions.json` name must be `nodejs-todoapp` (fixed in `buildspec.yaml`) |
| Local: app exits `ECONNREFUSED` | database not ready → `docker compose ps`, `docker compose logs db` |
