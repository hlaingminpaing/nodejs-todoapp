# Node.js To-Do App

A simple To-Do web application built with Node.js, Express, and EJS, fully containerized and ready for AWS deployment via CodeBuild, CodeDeploy, and CodePipeline.

> **Database:** todos are stored in **PostgreSQL** — locally in a Docker Compose container, on AWS in **Amazon RDS**.
> Setup, configuration and the RDS console guide: **[RDS_SETUP.md](RDS_SETUP.md)**.

## Table of Contents
- [Local Development](#local-development)
- [Docker Setup](#docker-setup)
- [AWS CI/CD Architecture](#aws-cicd-architecture)
- [Prerequisites](#prerequisites)
- [AWS Setup Guide](#aws-setup-guide) (ECS + RDS PostgreSQL, Steps 1–12)
- [RDS details, local database, checking data](RDS_SETUP.md)
- [CI/CD Pipeline Configuration](#cicd-pipeline-configuration)
- [Deployment Instructions](#deployment-instructions)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Local Development

### Quick Start

```bash
docker compose up -d --build      # app + PostgreSQL
```

The app will be available at `http://localhost:3000` (health: `/health`). Running `npm start` directly needs a
PostgreSQL database and the `DB_*` environment variables — see [RDS_SETUP.md](RDS_SETUP.md#1-run-locally-with-docker-compose).

### Requirements
- Node.js 20+
- npm or yarn

---

## Docker Setup

### Build Docker Image

```bash
docker build -t todo-web-app .
```

### Run Docker Container

> The container needs a PostgreSQL database (`DB_*` variables). Easiest: `docker compose up -d --build` (see [RDS_SETUP.md](RDS_SETUP.md)). The plain `docker run` below only works with `-e DB_HOST=... -e DB_USER=... -e DB_PASSWORD=... -e DB_NAME=...` added.

```bash
docker run -p 3000:3000 todo-web-app
```

The app will be available at `http://localhost:3000`

### Verify Container

```bash
docker ps
```

---

## AWS CI/CD Architecture

This repository is configured for a complete AWS CI/CD pipeline. The application runs on **ECS Fargate** behind an
**Application Load Balancer** and stores its data in **Amazon RDS for PostgreSQL**:

```
GitHub/CodeCommit ─► CodePipeline ─► CodeBuild (build image, push to ECR, register task definition) ─► CodeDeploy
                                                                                                         │
Internet ─► Application Load Balancer :80 ─► ECS Fargate service "todo-web-app-service1" (container :3000) ◄┘
                                                  │  TLS :5432                       ▲ DB_USER / DB_PASSWORD at task start
                                                  ▼                                  │
                                       Amazon RDS for PostgreSQL "todo-db"     AWS Secrets Manager (secret managed by RDS)
```

### Components Overview

| Component | Purpose | Config File |
|-----------|---------|-------------|
| **CodeBuild** | Builds Docker image, pushes to ECR, fills and registers the task definition | `buildspec.yaml` |
| **CodeDeploy** | Updates ECS service with new task definition | `appspec.yaml` |
| **ECS Fargate** | Runs containerized application | `task-definition.json` |
| **ECR** | Stores Docker images | AWS Console |
| **RDS for PostgreSQL** | Stores the todos (table `todos`, created by the app on first start) | AWS Console |
| **Secrets Manager** | Holds the database user/password (created and rotated by RDS), injected into the container | `task-definition.json` (`secrets`) |
| **CloudWatch Logs** | Application logs (`/ecs/todo-web-app`) | `task-definition.json` |

---

## Prerequisites

Before setting up the CI/CD pipeline, ensure you have:

1. **AWS Account** with appropriate permissions; region used below: **ap-southeast-1 (Singapore)**
2. **VPC** with subnets in **at least 2 Availability Zones** (the ALB and the RDS subnet group both need 2 AZs) — the default VPC works
3. **Docker** and **AWS CLI v2** on your machine (for manual builds and checks)

Order of the steps below: network/security groups → database → permissions → registry/logs → cluster → task definition → load balancer → service → pipeline.

---

## AWS Setup Guide

### Step 1: Create IAM Roles

#### Create CodeBuild Service Role
1. Go to [IAM Console](https://console.aws.amazon.com/iam/home)
2. Click **Roles** → **Create role**
3. Select **CodeBuild** as the trusted entity
4. Attach policies:
   - `AmazonEC2ContainerRegistryFullAccess`
   - `AmazonECS_FullAccess`
   - `AmazonS3FullAccess`
   - `AWSCodeBuildAdminAccess`
5. Name it `CodeBuildServiceRole` → **Create role**

#### Create ECS Task Execution Role
1. Create another role with trust entity: **Elastic Container Service** → **Elastic Container Service Task**
2. Attach policy: **`AmazonECSTaskExecutionRolePolicy`** (pull images from ECR **and** write CloudWatch logs)
3. Name it `ecsTaskExecutionRole` → **Create role**
4. The permission to read the database secret is added in [Step 4](#step-4-allow-ecs-to-read-the-database-secret) (the secret exists only after Step 3).

### Step 2: Create Security Groups

**EC2 → Security Groups → Create security group** (all in the same VPC):

| Name | Inbound rule | Used by |
|------|--------------|---------|
| `todo-alb-sg` | HTTP **80** from `0.0.0.0/0` | Application Load Balancer |
| `todo-tasks-sg` | Custom TCP **3000** from **`todo-alb-sg`** | ECS tasks |
| `todo-db-sg` | PostgreSQL **5432** from **`todo-tasks-sg`** | RDS database |

Outbound: keep the default (all). Result: the internet can reach only the load balancer, the load balancer only the tasks,
and only the tasks can reach the database.

### Step 3: Create the RDS PostgreSQL Database

1. Go to [Amazon RDS Console](https://console.aws.amazon.com/rds/home) → **Databases** → **Create database**
2. **Standard create** → Engine **PostgreSQL** → Engine version: latest **PostgreSQL 18.x**
3. Templates: **Free tier** (if offered) or **Dev/Test** → Availability: **Single-AZ DB instance**
4. Settings:
   - **DB instance identifier**: `todo-db`
   - **Master username**: `todoadmin`
   - **Credentials management**: **Managed in AWS Secrets Manager** (RDS generates, stores and rotates the password)
5. Instance configuration: **Burstable classes** → **db.t4g.micro** · Storage: **gp3, 20 GiB**
6. Connectivity:
   - **Don't connect to an EC2 compute resource**
   - **VPC**: your VPC · **DB subnet group**: Create new
   - **Public access**: **No**
   - **VPC security group**: Choose existing → **`todo-db-sg`** (remove `default`)
7. **Additional configuration** → **Initial database name**: **`todo`** (required — the app connects to this database) ·
   Backup retention 1–7 days
8. **Create database** → wait for Status **Available** (≈ 10–15 min)
9. Write down two values (needed in Steps 4, 8 and in `buildspec.yaml`):
   - **Endpoint** (Connectivity & security tab), e.g. `todo-db.abc123xyz.ap-southeast-1.rds.amazonaws.com` → `DB_HOST`
   - **Master credentials ARN** (Configuration tab; also in Secrets Manager as `rds!db-...`) → `DB_SECRET_ARN`

The app creates the `todos` table itself on first start. TLS is enforced by RDS; the app connects with `DB_SSL=verify-full`
using the Amazon RDS CA bundle that the `Dockerfile` puts into the image.

### Step 4: Allow ECS to Read the Database Secret

**IAM → Roles → `ecsTaskExecutionRole` → Add permissions → Create inline policy → JSON**:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "secretsmanager:GetSecretValue",
    "Resource": "<DB_SECRET_ARN from Step 3>"
  }]
}
```
Policy name: `read-todo-db-secret` → **Create policy**.

### Step 5: Create ECR Repository and Log Group

1. Go to [Amazon ECR Console](https://console.aws.amazon.com/ecr/home) → **Create repository** → name `todo-web-app` → **Create repository**
2. Go to **CloudWatch → Log groups → Create log group** → name **`/ecs/todo-web-app`** (retention e.g. 7 days)
   (the task definition sends logs there; the execution role can write to it but not create it)

### Step 6: Create ECS Cluster

1. Go to [Amazon ECS Console](https://console.aws.amazon.com/ecs/home)
2. Click **Create cluster**
3. **Cluster name**: `todo-app-cluster`
4. **Infrastructure**: Select **AWS Fargate**
5. Click **Create**

### Step 7: Build and Push the First Image

```bash
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com
docker build --platform linux/amd64 -t YOUR_ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/todo-web-app:v1 .
docker push YOUR_ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/todo-web-app:v1
```
(Later builds are done by CodeBuild with a timestamp tag.)

### Step 8: Create ECS Task Definition

1. Go to [Task Definitions](https://console.aws.amazon.com/ecs/home#/taskDefinitions) → **Create new task definition**
2. Fill in:
   - **Family name**: `todo-web-app-task`
   - **Launch type**: AWS Fargate · **OS/Architecture**: Linux/X86_64 · **CPU** .25 vCPU · **Memory** .5 GB
   - **Task execution role**: `ecsTaskExecutionRole`
   - **Container name**: `nodejs-todoapp`
   - **Image**: `<AWS_ACCOUNT_ID>.dkr.ecr.ap-southeast-1.amazonaws.com/todo-web-app:v1`
   - **Container port**: `3000` (TCP)
   - **Environment variables** (key / value):

     | Key | Value type | Value |
     |-----|------------|-------|
     | `DB_HOST` | Value | `<DB_HOST from Step 3>` |
     | `DB_PORT` | Value | `5432` |
     | `DB_NAME` | Value | `todo` |
     | `DB_SSL` | Value | `verify-full` |
     | `DB_USER` | **ValueFrom** | `<DB_SECRET_ARN>:username::` |
     | `DB_PASSWORD` | **ValueFrom** | `<DB_SECRET_ARN>:password::` |

   - **Health check**: command `CMD-SHELL, wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1`, interval 30, timeout 5, retries 3, start period 30
   - **Log collection**: Amazon CloudWatch, log group `/ecs/todo-web-app`
3. Click **Create**

**Or use the provided `task-definition.json`**: CodeBuild fills the `$...` placeholders (account, region, image, family,
`DB_HOST`, `DB_SECRET_ARN`) and registers it — see [CI/CD Pipeline Configuration](#cicd-pipeline-configuration).

### Step 9: Create the Load Balancer

1. **EC2 → Target Groups → Create target group**: target type **IP addresses**, name `todo-tg-1`, protocol **HTTP**, port **3000**,
   your VPC, health check path **`/health`** (returns 200 only when the database answers) → do not register targets → **Create**
2. For **CodeDeploy blue/green** create a second, identical target group `todo-tg-2`
3. **EC2 → Load Balancers → Create → Application Load Balancer**: name `todo-alb`, **Internet-facing**, your VPC, **2 public
   subnets**, security group **`todo-alb-sg`**, listener **HTTP:80 → forward to `todo-tg-1`** → **Create**

### Step 10: Create ECS Service

1. Go to your **ECS Cluster** → **Services** → **Create**
2. Fill in:
   - **Launch type**: Fargate
   - **Task definition**: `todo-web-app-task` (latest revision)
   - **Service name**: `todo-web-app-service1`
   - **Desired count**: 1 (try 2 later: both tasks share the same data in RDS)
   - **Deployment type**: Rolling update, or **Blue/green (CodeDeploy)** if you use the CodeDeploy stage
   - **VPC**: your VPC · **Subnets**: public subnets with **Public IP turned on** (or private subnets with a NAT Gateway) —
     tasks must reach ECR, CloudWatch Logs and **Secrets Manager** when they start
   - **Security group**: **`todo-tasks-sg`** only
   - **Load balancing**: Application Load Balancer → existing `todo-alb` → listener 80 → target group `todo-tg-1`
     (blue/green: production listener 80, target groups `todo-tg-1` / `todo-tg-2`)
3. Click **Create service** → wait until the task is **Running** and the target is **healthy**

### Step 11: Create S3 Bucket for Artifacts

1. Go to [Amazon S3 Console](https://console.aws.amazon.com/s3/)
2. Click **Create bucket**
3. **Bucket name**: `nodejsmtatodoappcodepipleline12` (or your preferred name)
4. Click **Create bucket**

### Step 12: Verify

1. Open `http://<todo-alb DNS name>` → add, complete and delete todos
2. `http://<todo-alb DNS name>/health` → `{"status":"ok","database":"up","host":"ip-10-..."}`
3. **Data survives deployments:** service → **Update service → Force new deployment** → todos are still there after the new task starts
4. **CloudWatch → Log groups → `/ecs/todo-web-app`** → `Connected to PostgreSQL database "todo" (PostgreSQL 18.x ...)`
5. Look at the rows in the database: [RDS_SETUP.md → Look at the data](RDS_SETUP.md#look-at-the-data)

---

## CI/CD Pipeline Configuration

### CodeBuild Configuration (buildspec.yaml)

The `buildspec.yaml` file defines the build process:

```yaml
- **Phase: pre_build** - Authenticate with ECR
- **Phase: build** - Build Docker image with timestamp tag
- **Phase: post_build** - Push image to ECR, register ECS task definition, update ECS service
- **Artifacts** - Output image definitions and task definition files
```

**Key Environment Variables:**
```yaml
AWS_ACCOUNT_ID: "YOUR_AWS_ACCOUNT_ID"
AWS_DEFAULT_REGION: "ap-southeast-1"
IMAGE_REPO_NAME: "todo-web-app"
ECS_CLUSTER: "todo-app-cluster"
SERVICE_NAME: "todo-web-app-service1"
TASK_DEF_FAMILY: "todo-web-app-task"
DB_HOST: "todo-db.abc123xyz.ap-southeast-1.rds.amazonaws.com"     # RDS endpoint (Step 3)
DB_SECRET_ARN: "arn:aws:secretsmanager:ap-southeast-1:<acct>:secret:rds!db-..."   # RDS-managed secret (Step 3)
```
`DB_HOST` and `DB_SECRET_ARN` are not secret themselves (the ARN only points to the secret); CodeBuild writes them into
`task-definition.json`. The password never appears in the repository, the image or the build logs.

### CodeDeploy Configuration (appspec.yaml)

The `appspec.yaml` file defines deployment to ECS:

```yaml
Resources:
  - TargetService:
      Type: AWS::ECS::Service
      Properties:
        TaskDefinition: "arn:aws:ecs:ap-southeast-1:203918878350:task-definition/todo-web-app-task"
        LoadBalancerInfo:
          ContainerName: "nodejs-todoapp"
          ContainerPort: 3000
```

---

## Deployment Instructions

### Method 1: Create CodePipeline (Fully Automated)

1. Go to [AWS CodePipeline Console](https://console.aws.amazon.com/codepipeline/home)
2. Click **Create pipeline**
3. **Pipeline name**: `todo-web-app-pipeline`
4. **Service role**: Create new or select existing
5. **Artifacts store**: Select S3 bucket (`nodejsmtatodoappcodepipleline12`)

#### Stage 1: Source
- **Source provider**: GitHub / CodeCommit (choose your repo provider)
- **Repository**: Your repository containing this code
- **Branch**: `main`

#### Stage 2: Build
- **Build provider**: AWS CodeBuild
- **Create project** or select existing:
  - **Project name**: `todo-web-app-build`
  - **Environment image**: `aws/codebuild/standard:6.0`
  - **Environment variables**:
    ```
    AWS_ACCOUNT_ID = YOUR_ACCOUNT_ID
    AWS_DEFAULT_REGION = ap-southeast-1
    ```
  - **Buildspec**: Use `buildspec.yaml` from repository
  - **Service role**: `CodeBuildServiceRole`

#### Stage 3: Deploy
- **Deploy provider**: Amazon AppConfig / CodeDeploy
- **Application name**: `todo-web-app`
- **Deployment group**: `todo-web-app-deployment`

6. Click **Create pipeline**

### Method 2: Manual Deployment

#### Build Docker Image
```bash
aws codebuild start-build \
  --project-name todo-web-app-build \
  --region ap-southeast-1
```

#### Push to ECR
```bash
# Login to ECR
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com

# Build and push
TAG=$(date +%Y%m%d%H%M%S)
docker build --platform linux/amd64 -t YOUR_ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/todo-web-app:$TAG .
docker push YOUR_ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/todo-web-app:$TAG
```

#### Register a Task Definition Revision and Update the Service
Create a new revision in the console with the new image (keep the `DB_*` variables from Step 8), or fill
`task-definition.json` like CodeBuild does and register it (`set +H` first: the secret ARN contains `!`, which
interactive bash would otherwise expand inside double quotes):
```bash
set +H
sed -e "s|\$AWS_ACCOUNT_ID|YOUR_ACCOUNT_ID|g" -e "s|\$AWS_DEFAULT_REGION|ap-southeast-1|g" \
    -e "s|\$IMAGE_REPO_NAME|todo-web-app|g" -e "s|\$IMAGE_TAG|$TAG|g" -e "s|\$TASK_DEF_FAMILY|todo-web-app-task|g" \
    -e "s|\$DB_HOST|<DB_HOST>|g" -e "s|\$DB_SECRET_ARN|<DB_SECRET_ARN>|g" task-definition.json > task-definition-temp.json
aws ecs register-task-definition --cli-input-json file://task-definition-temp.json --region ap-southeast-1
```
```bash
aws ecs update-service \
  --cluster todo-app-cluster \
  --service todo-web-app-service1 \
  --task-definition todo-web-app-task \
  --region ap-southeast-1
```

---

## Environment Variables

Configure these in **buildspec.yaml** and CodeBuild project:

| Variable | Value | Purpose |
|----------|-------|---------|
| `AWS_ACCOUNT_ID` | Your AWS Account ID | ECR image registry |
| `AWS_DEFAULT_REGION` | `ap-southeast-1` (or your region) | AWS region |
| `IMAGE_REPO_NAME` | `todo-web-app` | ECR repository name |
| `ECS_CLUSTER` | `todo-app-cluster` | ECS cluster name |
| `SERVICE_NAME` | `todo-web-app-service1` | ECS service name |
| `TASK_DEF_FAMILY` | `todo-web-app-task` | ECS task definition name |
| `DB_HOST` | RDS endpoint | Database host written into the task definition |
| `DB_SECRET_ARN` | RDS-managed secret ARN | Source of `DB_USER` / `DB_PASSWORD` (task definition `secrets`) |

Application (container) variables: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`, `DB_POOL_MAX`, `PORT` —
details in [RDS_SETUP.md](RDS_SETUP.md#environment-variables).

---

## Troubleshooting

### CodeBuild Failures

**Error: `docker: command not found`**
- Ensure CodeBuild environment has Docker support enabled
- Use `aws/codebuild/standard:6.0` or later

**Error: `AWS credential issues`**
- Verify `CodeBuildServiceRole` has required permissions
- Check IAM policies for ECR and ECS access

**Error: `imageUri` parsing error in task definition**
- Ensure `$IMAGE_REPO_NAME` and `$IMAGE_TAG` are properly substituted
- Check `buildspec.yaml` for sed command syntax

### ECS Service Issues

**Error: `Service failed to stabilize`**
- Check ECS task logs in CloudWatch
- Verify security group allows port 3000
- Ensure VPC/subnet configuration is correct

**Error: `ImagePullBackOff`**
- Verify ECR repository exists and image is pushed
- Check `ecsTaskExecutionRole` has ECR read permissions
- Verify task definition image URI is correct

### CodePipeline Failures

**Pipeline stuck in `In Progress`**
- Check CodeBuild build logs in CloudWatch
- Review CodeDeploy deployment events
- Verify S3 artifact bucket exists and is accessible

### Database (RDS) Issues

| Log message (`/ecs/todo-web-app`) or task error | Fix |
|---|---|
| `ResourceInitializationError: unable to pull secrets` | Step 4 policy missing/wrong ARN, or tasks cannot reach Secrets Manager (public IP / NAT) |
| `Missing environment variable DB_HOST` | task definition revision without the `DB_*` variables (Step 8) |
| `Database not reachable ... ETIMEDOUT` | `todo-db-sg` must allow 5432 from `todo-tasks-sg`; RDS in the same VPC |
| `password authentication failed` | wrong secret ARN, or password rotated → **Force new deployment** (secrets are read at task start) |
| `database "todo" does not exist` | "Initial database name" was empty in Step 3 → create database `todo` |
| `unable to verify the first certificate` | image built before the RDS CA bundle was added → rebuild |
| Target group: unhealthy (503 on `/health`) | the task cannot reach the database — see the lines above |

More: [RDS_SETUP.md → Troubleshooting](RDS_SETUP.md#troubleshooting).

### Health Check Issues

**Error: `curl: (7) Failed to connect to localhost port 3000`**
- Verify application is running: `docker ps`
- Check application logs: `docker logs <container_id>`
- Ensure port 3000 is exposed in task definition

---

## Application Architecture

- **Framework**: Express.js
- **Template Engine**: EJS
- **Port**: 3000
- **Features**:
  - Add todo items
  - Mark todos as completed
  - Delete todos
  - Data stored in PostgreSQL (Amazon RDS on AWS, a container locally) — survives restarts and deployments
  - `/health` endpoint (checks the database)

## Next Steps

1. Clone this repository
2. Update AWS account ID and region in all config files
3. Create IAM roles and AWS resources, including the RDS database (Steps 1–11)
4. Put `DB_HOST` and `DB_SECRET_ARN` into `buildspec.yaml`
5. Push code to GitHub/CodeCommit
6. Create CodePipeline
7. Monitor deployments in AWS Console

---

## Support

For issues or questions:
1. Check application logs: `docker logs <container_id>`
2. Review CloudWatch logs in AWS Console
3. Verify IAM roles and permissions
4. Check security group and network configuration

