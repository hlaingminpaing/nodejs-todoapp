## If you run this project in local

```
npm install
npm start
```

## If you run this project with docker
```
docker build -t todo-web-app .
docker run -p 3000:3000 todo-web-app
```

## Create ECR Repo
 Go to the [Amazon ECR console](https://console.aws.amazon.com/ecr/home).
   - Click **Create repository**.
   - Enter `todo-web-app` as the repository name and click **Create repository**.

2. **Push Your Docker Image**
   - Follow the instructions on the ECR repository page:
     - Open the repository you just created.
     - Click on **View push commands** to get the commands for pushing the image.
     - Execute the commands in your terminal to build, tag, and push the image to ECR.

## Building the Docker Image with CodeBuild

1. **Go to CodeBuild**
   - Open the [AWS CodeBuild console](https://console.aws.amazon.com/codebuild/home).

2. **Create a Build Project**
   - Click **Create build project**.
   - Enter `todo-web-app-build` as the project name.
   - In **Source**, choose the source provider (e.g., GitHub or CodeCommit).
   - Connect your repository where your Dockerfile and application code are stored.
   - In **Environment**, choose:
     - Environment image: **Managed image**.
     - Operating system: **Amazon Linux 2**.
     - Runtime: **Standard**.
     - Image: **aws/codebuild/standard:6.0**.
     - Check **Enable this project to build Docker images**.
     - Add variable 
        - AWS_DEFAULT_REGION with a value of region-ID
        - AWS_ACCOUNT_ID with a value of account-ID
        - IMAGE_TAG with a value of Latest
        - IMAGE_REPO_NAME with a value of Amazon-ECR-repo-name
        
   - In **Buildspec**, select **Insert build commands** and use the following content or you can use buildspec.yaml
    
    
   ```
    version: 0.2
    phases:
        pre_build:
            commands:
                - echo Logging in to Amazon ECR...
                - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
        build:
            commands:
                - echo Build started on `date`
                - echo Building the Docker image...          
                - docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .
                - docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG      
        post_build:
            commands:
                - echo Build completed on `date`
                - echo Pushing the Docker image...
                - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG
