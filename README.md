# Node.js To-Do App

A simple To-Do web application built with Node.js, Express, and EJS, fully containerized and ready for AWS deployment via CodeBuild, CodeDeploy, and CodePipeline.

## Table of Contents
- [Local Development](#local-development)
- [Docker Setup](#docker-setup)
- [AWS CI/CD Architecture](#aws-cicd-architecture)
- [Prerequisites](#prerequisites)
- [AWS Setup Guide](#aws-setup-guide)
- [CI/CD Pipeline Configuration](#cicd-pipeline-configuration)
- [Deployment Instructions](#deployment-instructions)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Local Development

### Quick Start

```bash
npm install
npm start
```

The app will be available at `http://localhost:3000`

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

This repository is configured for a complete AWS CI/CD pipeline:

```
GitHub/CodeCommit Repository
        ↓
   AWS CodePipeline
        ↓
   AWS CodeBuild (Build & Push Docker Image)
        ↓
   Amazon ECR (Docker Image Registry)
        ↓
   AWS CodeDeploy (Update ECS Service)
        ↓
   Amazon ECS Fargate (Run Application)
```

### Components Overview

| Component | Purpose | Config File |
|-----------|---------|-------------|
| **CodeBuild** | Builds Docker image, runs tests, pushes to ECR, updates task definition | `buildspec.yaml` |
| **CodeDeploy** | Updates ECS service with new task definition | `appspec.yaml` |
| **ECS Fargate** | Runs containerized application | `task-definition.json` |
| **ECR** | Stores Docker images | AWS Console |

---

## Prerequisites

Before setting up the CI/CD pipeline, ensure you have:

1. **AWS Account** with appropriate permissions
2. **IAM Roles** created:
   - `CodeBuildServiceRole` - for CodeBuild to access ECR and ECS
   - `ecsTaskExecutionRole` - for ECS tasks to pull images from ECR
3. **S3 Bucket** - for storing pipeline artifacts
4. **VPC and Security Groups** - for ECS Fargate networking

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
1. Create another role with trust entity: **Elastic Container Service Task**
2. Attach policy: `AmazonEC2ContainerRegistryReadOnlyAccess`
3. Name it `ecsTaskExecutionRole` → **Create role**

### Step 2: Create ECR Repository

1. Go to [Amazon ECR Console](https://console.aws.amazon.com/ecr/home)
2. Click **Create repository**
3. Repository name: `todo-web-app`
4. Click **Create repository**

### Step 3: Create ECS Cluster

1. Go to [Amazon ECS Console](https://console.aws.amazon.com/ecs/home)
2. Click **Create cluster**
3. **Cluster name**: `todo-app-cluster`
4. **Infrastructure**: Select **AWS Fargate**
5. Click **Create**

### Step 4: Create ECS Task Definition

1. Go to [Task Definitions](https://console.aws.amazon.com/ecs/home#/taskDefinitions)
2. Click **Create new task definition**
3. Fill in:
   - **Family name**: `todo-web-app-task`
   - **Container name**: `nodejs-todoapp`
   - **Image**: `<AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/todo-web-app:latest`
   - **Container port**: `3000`
   - **Task execution role**: `ecsTaskExecutionRole`
   - **CPU**: 256
   - **Memory**: 512
4. Click **Create**

**Or use the provided `task-definition.json`** (update account ID and region)

### Step 5: Create ECS Service

1. Go to your **ECS Cluster** → **Services** → **Create**
2. Fill in:
   - **Launch type**: Fargate
   - **Task definition**: `todo-web-app-task`
   - **Service name**: `todo-web-app-service1`
   - **Desired count**: 1
   - **VPC**: Select your VPC
   - **Subnets**: Select public subnets
   - **Security group**: Allow inbound HTTP (port 3000)
3. Click **Create service**

### Step 6: Create S3 Bucket for Artifacts

1. Go to [Amazon S3 Console](https://console.aws.amazon.com/s3/)
2. Click **Create bucket**
3. **Bucket name**: `nodejsmtatodoappcodepipleline12` (or your preferred name)
4. Click **Create bucket**

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
```

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
docker build -t todo-web-app:latest .
docker tag todo-web-app:latest YOUR_ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/todo-web-app:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/todo-web-app:latest
```

#### Update ECS Service
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
  - In-memory storage (resets on restart)

## Next Steps

1. Clone this repository
2. Update AWS account ID and region in all config files
3. Create IAM roles and AWS resources
4. Push code to GitHub/CodeCommit
5. Create CodePipeline
6. Monitor deployments in AWS Console

---

## Support

For issues or questions:
1. Check application logs: `docker logs <container_id>`
2. Review CloudWatch logs in AWS Console
3. Verify IAM roles and permissions
4. Check security group and network configuration

