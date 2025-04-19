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

Here's a **step-by-step guide using the AWS Management Console (GUI)** to deploy your Dockerized To-Do application to **Amazon ECS** using **AWS CodeBuild** and **AWS CodeDeploy**.

---

## **Part 1: Setting Up the Environment**

### Step 1: **Push Docker Image to Amazon ECR**

1. **Create an ECR Repository**
   - Go to the [Amazon ECR console](https://console.aws.amazon.com/ecr/home).
   - Click **Create repository**.
   - Enter `todo-web-app` as the repository name and click **Create repository**.

2. **Push Your Docker Image**
   - Follow the instructions on the ECR repository page:
     - Open the repository you just created.
     - Click on **View push commands** to get the commands for pushing the image.
     - Execute the commands in your terminal to build, tag, and push the image to ECR.

---

### Step 1: **Create an ECS Cluster**

1. Open the [Amazon ECS console](https://console.aws.amazon.com/ecs/home).
2. Click **Create cluster**.
3. Select **Networking only (Fargate)** and click **Next step**.
4. Enter `todo-app-cluster` as the cluster name and click **Create**.

---
### Step 2: **Create ECS Task Definition**

1. Go to the [Task Definitions page](https://console.aws.amazon.com/ecs/home#/taskDefinitions).
2. Click **Create new task definition** and choose **Fargate**.
3. Configure the task:
   - Task definition name: `todo-web-app-task`.
   - Task role: Leave as default.
   - Add container:
     - Name: `todo-web-app-container`.
     - Image: `<account_id>.dkr.ecr.<region>.amazonaws.com/todo-web-app:latest`.
     - Port mappings: `3000` (for container port).
4. Click **Create**.

---
### Step 3: **Create ECS Service**

1. Go to the [ECS Services page](https://console.aws.amazon.com/ecs/home#/clusters).
2. Click on the `todo-app-cluster` and click **Create service**.
3. Configure the service:
   - Launch type: **Fargate**.
   - Service name: `todo-web-app-service`.
   - Task definition: Choose the one you created.
   - Number of tasks: `1`.
   - VPC and subnets: Select appropriate ones.
   - Security group: Allow HTTP traffic (port 3000).
4. Click **Create service**.

---

## **Part 2: Building the Docker Image with CodeBuild**

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
   - In **Buildspec**, select **Use a buildspec file** 

3. **Start the Build**
   - Save the project and start the build.
   - Once completed, the Docker image will be in your ECR repository.

---

### Create codepiple and test run

