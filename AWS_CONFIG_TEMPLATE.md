# AWS Configuration Template

## Instructions
1. Copy this file as `.env.example`
2. Update all values with your AWS details
3. Never commit sensitive values to version control

## AWS Account Information
```
AWS_ACCOUNT_ID=203918878350
AWS_REGION=ap-southeast-1
AWS_AVAILABILITY_ZONES=ap-southeast-1a,ap-southeast-1b
```

## IAM Roles
```
CODEBUILD_SERVICE_ROLE_ARN=arn:aws:iam::203918878350:role/CodeBuildServiceRole
ECS_TASK_EXECUTION_ROLE_ARN=arn:aws:iam::203918878350:role/ecsTaskExecutionRole
```

## ECR Configuration
```
ECR_REPOSITORY_NAME=todo-web-app
ECR_REPOSITORY_URI=203918878350.dkr.ecr.ap-southeast-1.amazonaws.com/todo-web-app
ECR_IMAGE_TAG=latest
```

## ECS Configuration
```
ECS_CLUSTER_NAME=todo-app-cluster
ECS_SERVICE_NAME=todo-web-app-service1
ECS_TASK_DEFINITION_FAMILY=todo-web-app-task
ECS_TASK_DEFINITION_REVISION=1
ECS_TASK_CPU=256
ECS_TASK_MEMORY=512
ECS_DESIRED_COUNT=1
```

## Application Configuration
```
APP_NAME=todo-web-app
APP_PORT=3000
APP_VERSION=1.0.0
```

## Docker Configuration
```
DOCKER_IMAGE_NAME=todo-web-app
DOCKER_IMAGE_TAG=latest
DOCKER_REGISTRY_URL=203918878350.dkr.ecr.ap-southeast-1.amazonaws.com
```

## CodeBuild Configuration
```
CODEBUILD_PROJECT_NAME=todo-web-app-build
CODEBUILD_ENVIRONMENT_IMAGE=aws/codebuild/standard:6.0
CODEBUILD_COMPUTE_TYPE=BUILD_GENERAL1_SMALL
```

## CodePipeline Configuration
```
CODEPIPELINE_NAME=todo-web-app-pipeline
CODEPIPELINE_ARTIFACT_BUCKET=nodejsmtatodoappcodepipleline12
CODEPIPELINE_ARTIFACT_PATH=nodejsmtatodoappcodepipleline12/todo-app
```

## CodeDeploy Configuration
```
CODEDEPLOY_APPLICATION_NAME=todo-web-app
CODEDEPLOY_DEPLOYMENT_GROUP=todo-web-app-deployment
```

## VPC Configuration
```
VPC_ID=vpc-xxxxxxxxxxxxx
SUBNET_ID_1=subnet-xxxxxxxxxxxxx
SUBNET_ID_2=subnet-xxxxxxxxxxxxx
SECURITY_GROUP_ID=sg-xxxxxxxxxxxxx
ASSIGN_PUBLIC_IP=ENABLED
```

## Database (if needed in future)
```
# DB_HOST=your-db-host
# DB_PORT=3306
# DB_NAME=todo_app
# DB_USER=admin
# DB_PASSWORD=your-secure-password
```

## GitHub/CodeCommit Configuration
```
SOURCE_REPOSITORY_TYPE=GITHUB
SOURCE_REPOSITORY_OWNER=YOUR_USERNAME
SOURCE_REPOSITORY_NAME=nodejs-todoapp
SOURCE_REPOSITORY_BRANCH=main
```

## Logging Configuration
```
CLOUDWATCH_LOG_GROUP=/ecs/todo-web-app-task
CLOUDWATCH_LOG_STREAM_PREFIX=ecs
```

## Optional: Load Balancer Configuration
```
# ALB_ARN=arn:aws:elasticloadbalancing:...
# ALB_TARGET_GROUP_ARN=arn:aws:elasticloadbalancing:...
# ALB_LISTENER_PORT=80
```

## Notes
- All values in this template are examples
- Replace with your actual AWS account IDs and resource names
- Store sensitive credentials in AWS Secrets Manager
- Use IAM roles instead of access keys when possible
- Keep this file updated as your infrastructure changes
