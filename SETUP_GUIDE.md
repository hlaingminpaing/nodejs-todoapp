# AWS CI/CD Setup Quick Reference

This guide provides a quick checklist for setting up the complete AWS CI/CD pipeline for the Node.js To-Do app.

## Pre-Setup Checklist

- [ ] AWS Account created
- [ ] AWS CLI installed and configured (`aws configure`)
- [ ] Docker installed locally
- [ ] GitHub or CodeCommit repository created with this code pushed

## Configuration Values

**Replace these with your actual values:**

| Variable | Your Value |
|----------|-----------|
| `AWS_ACCOUNT_ID` | `203918878350` |
| `AWS_REGION` | `ap-southeast-1` |
| `AWS_AVAILABILITY_ZONES` | `ap-southeast-1a, ap-southeast-1b` |
| `VPC_ID` | (create new or use existing) |
| `SUBNET_IDS` | (2 public subnets recommended) |
| `SECURITY_GROUP_ID` | (create new with port 3000 allowed) |

## Step-by-Step Setup

### 1️⃣ Create IAM Roles (5 minutes)

```bash
# Create CodeBuild Service Role
aws iam create-role \
  --role-name CodeBuildServiceRole \
  --assume-role-policy-document file://- << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "codebuild.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Attach policies to CodeBuild role
aws iam attach-role-policy \
  --role-name CodeBuildServiceRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess

aws iam attach-role-policy \
  --role-name CodeBuildServiceRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonECS_FullAccess

aws iam attach-role-policy \
  --role-name CodeBuildServiceRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
```

### 2️⃣ Create ECR Repository (2 minutes)

```bash
aws ecr create-repository \
  --repository-name todo-web-app \
  --region ap-southeast-1
```

**Output:** Note the repository URI
```
REPOSITORY_URI=YOUR_ACCOUNT_ID.dkr.ecr.ap-southeast-1.amazonaws.com/todo-web-app
```

### 3️⃣ Create ECS Cluster (3 minutes)

```bash
aws ecs create-cluster \
  --cluster-name todo-app-cluster \
  --region ap-southeast-1
```

### 4️⃣ Create ECS Task Definition (3 minutes)

```bash
# Update task-definition.json with your values first
sed -i "s/203918878350/YOUR_ACCOUNT_ID/g" task-definition.json
sed -i "s/ap-southeast-1/YOUR_REGION/g" task-definition.json

# Register task definition
aws ecs register-task-definition \
  --cli-input-json file://task-definition.json \
  --region ap-southeast-1
```

### 5️⃣ Create ECS Service (5 minutes)

```bash
aws ecs create-service \
  --cluster todo-app-cluster \
  --service-name todo-web-app-service1 \
  --task-definition todo-web-app-task \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxxx,subnet-yyyyy],securityGroups=[sg-xxxxx],assignPublicIp=ENABLED}" \
  --region ap-southeast-1
```

### 6️⃣ Create S3 Bucket for Artifacts (2 minutes)

```bash
aws s3 mb s3://nodejsmtatodoappcodepipleline12 \
  --region ap-southeast-1
```

### 7️⃣ Update buildspec.yaml with Your Values

```yaml
env:
  variables:
    AWS_ACCOUNT_ID: "203918878350"        # ← UPDATE THIS
    AWS_DEFAULT_REGION: "ap-southeast-1"  # ← UPDATE THIS
    IMAGE_REPO_NAME: "todo-web-app"
    ECS_CLUSTER: "todo-app-cluster"
    SERVICE_NAME: "todo-web-app-service1"
    TASK_DEF_FAMILY: "todo-web-app-task"
```

### 8️⃣ Create CodeBuild Project (5 minutes)

```bash
aws codebuild create-project \
  --name todo-web-app-build \
  --source type=GITHUB,location=https://github.com/YOUR_USERNAME/nodejs-todoapp \
  --artifacts type=S3,location=nodejsmtatodoappcodepipleline12 \
  --service-role arn:aws:iam::203918878350:role/CodeBuildServiceRole \
  --environment type=LINUX_CONTAINER,image=aws/codebuild/standard:6.0,computeType=BUILD_GENERAL1_SMALL,environmentVariables='[{name=AWS_ACCOUNT_ID,value=203918878350},{name=AWS_DEFAULT_REGION,value=ap-southeast-1}]' \
  --region ap-southeast-1
```

### 9️⃣ Create CodePipeline (10 minutes)

**Use AWS Console for this step:**

1. Go to [CodePipeline Console](https://console.aws.amazon.com/codepipeline/)
2. Click **Create pipeline**
3. **Pipeline name:** `todo-web-app-pipeline`
4. **Artifacts store:** Select S3 bucket `nodejsmtatodoappcodepipleline12`
5. **Add source stage:**
   - Provider: GitHub
   - Repository: `nodejs-todoapp`
   - Branch: `main`
6. **Add build stage:**
   - Provider: CodeBuild
   - Project name: `todo-web-app-build`
7. **Add deploy stage:**
   - Provider: CodeDeploy
   - Application name: `todo-web-app`
   - Deployment group: `todo-web-app-deployment`
8. **Create pipeline**

## Verification Checklist

After setup, verify each component:

- [ ] ECR repository contains `todo-web-app` image
- [ ] ECS cluster `todo-app-cluster` is active
- [ ] ECS service `todo-web-app-service1` is running
- [ ] CodeBuild project `todo-web-app-build` exists
- [ ] CodePipeline `todo-web-app-pipeline` is created
- [ ] Application is accessible at ECS service URL on port 3000

## Test the Pipeline

### Trigger a manual build:

```bash
aws codebuild start-build \
  --project-name todo-web-app-build \
  --region ap-southeast-1
```

### Monitor build progress:

```bash
aws codebuild batch-get-builds \
  --ids <BUILD_ID_FROM_ABOVE> \
  --region ap-southeast-1
```

### Check ECS service status:

```bash
aws ecs describe-services \
  --cluster todo-app-cluster \
  --services todo-web-app-service1 \
  --region ap-southeast-1
```

### View task logs:

```bash
aws logs tail /ecs/todo-web-app-task --follow --region ap-southeast-1
```

## Troubleshooting Commands

### Check CodeBuild Logs
```bash
aws codebuild batch-get-builds --ids <BUILD_ID> --region ap-southeast-1
```

### Check ECS Task Status
```bash
aws ecs list-tasks --cluster todo-app-cluster --region ap-southeast-1
aws ecs describe-tasks --cluster todo-app-cluster --tasks <TASK_ARN> --region ap-southeast-1
```

### Check ECR Images
```bash
aws ecr list-images --repository-name todo-web-app --region ap-southeast-1
```

### Check S3 Artifacts
```bash
aws s3 ls s3://nodejsmtatodoappcodepipleline12/ --recursive
```

## Cost Estimation (Monthly)

| Service | Estimated Cost |
|---------|----------------|
| ECR Storage | $0.10 |
| ECS Fargate (0.25 CPU, 512 MB) | $6.50 |
| CodeBuild (100 min/month) | $0.50 |
| S3 Storage | $0.05 |
| **Total** | **~$7-10/month** |

## Environment Variable Reference

**buildspec.yaml:**
```yaml
AWS_ACCOUNT_ID: AWS account number (e.g., 203918878350)
AWS_DEFAULT_REGION: AWS region (e.g., ap-southeast-1)
IMAGE_REPO_NAME: ECR repository name (e.g., todo-web-app)
ECS_CLUSTER: ECS cluster name (e.g., todo-app-cluster)
SERVICE_NAME: ECS service name (e.g., todo-web-app-service1)
TASK_DEF_FAMILY: ECS task definition family (e.g., todo-web-app-task)
```

**task-definition.json:**
- Update `$AWS_ACCOUNT_ID` with your account ID
- Update `$AWS_DEFAULT_REGION` with your region
- Update `$IMAGE_REPO_NAME` with repository name
- Update `$IMAGE_TAG` with image tag (auto-set by buildspec.yaml)

## Security Best Practices

- [ ] Use VPC endpoints for ECR and S3
- [ ] Enable encryption for S3 bucket
- [ ] Use least privilege IAM policies
- [ ] Enable CloudWatch logs for ECS tasks
- [ ] Regularly update base Docker image
- [ ] Use secrets manager for sensitive data
- [ ] Enable VPC Flow Logs for network monitoring

## Clean Up Resources

```bash
# Delete pipeline
aws codepipeline delete-pipeline --name todo-web-app-pipeline

# Delete ECS service
aws ecs delete-service --cluster todo-app-cluster --service todo-web-app-service1 --force

# Delete ECS cluster
aws ecs delete-cluster --cluster todo-app-cluster

# Delete ECR repository
aws ecr delete-repository --repository-name todo-web-app --force

# Delete S3 bucket
aws s3 rm s3://nodejsmtatodoappcodepipleline12 --recursive
aws s3 rb s3://nodejsmtatodoappcodepipleline12

# Delete IAM roles
aws iam detach-role-policy --role-name CodeBuildServiceRole --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess
aws iam delete-role --role-name CodeBuildServiceRole
```

## Additional Resources

- [AWS CodeBuild Documentation](https://docs.aws.amazon.com/codebuild/)
- [AWS CodePipeline Documentation](https://docs.aws.amazon.com/codepipeline/)
- [AWS CodeDeploy Documentation](https://docs.aws.amazon.com/codedeploy/)
- [Amazon ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [Amazon ECR Documentation](https://docs.aws.amazon.com/ecr/)
