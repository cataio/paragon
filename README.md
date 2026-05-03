# Paragon

**Three CloudFormation Guard Hooks that block insecure AWS resources before they exist.**

If you run a security team, you already know AWS Config. It tells you when a resource is non-compliant after it has been deployed. Paragon flips that. The deployment receives a CloudFormation Guard verdict before the resource is created.

Three controls. Report-only by default. One CDK import.

## What you get

Paragon ships three preventive controls in v1, each mapped to AWS Foundational Security Best Practices (FSBP), AWS's reference catalog for AWS-native security controls:

1. **Lambda functions must have X-Ray tracing enabled.** Without active tracing, you cannot reconstruct an attacker's call chain across your serverless surface during an incident. Maps to FSBP `Lambda.7`.
2. **S3 buckets must block public access at the bucket level.** This is the bucket-level guardrail that keeps public access from becoming the default. Maps to FSBP `S3.8`.
3. **IAM policies must not combine wildcard actions with wildcard resources.** The `"Action": "*"` plus `"Resource": "*"` pattern is the classic privilege escalation footprint that turns a single compromised role into account-wide impact. Aligns with the full administrative privilege pattern in FSBP `IAM.1`.

Each control is enforced as a CloudFormation Guard Hook, which means the policy runs inside CloudFormation and Cloud Control API operations, not as a separate scanner you have to remember to invoke.

## Install

You need an AWS account, the AWS CDK (Cloud Development Kit, AWS's infrastructure-as-code framework) installed, and Node.js 20 or later. If you have never used the CDK before, run:

```bash
npm install -g aws-cdk
cdk bootstrap
```

The bootstrap command provisions the small set of resources the CDK uses to manage deployments.

Then install Paragon:

```bash
npm install @cataio/paragon
```

In your CDK app, register the controls with one constructor:

```typescript
import { App, Stack } from 'aws-cdk-lib';
import { ParagonControls } from '@cataio/paragon';

const app = new App();
const stack = new Stack(app, 'ParagonStack');

new ParagonControls(stack, 'Controls');

app.synth();
```

Then deploy:

```bash
cdk deploy
```

That is the whole installation path.

## First run: report-only

Paragon installs in **report-only** mode by default. This is deliberate. A tool that hard-blocks deployments on day one is a tool that gets uninstalled on day two.

Report-only maps to Guard Hook `WARN` mode. CloudFormation continues the deployment, but the hook returns a warning when a resource violates a policy. If you configure the default Paragon log bucket, detailed Guard output is written there.

## Turning on enforcement

When you are ready, opt into enforce mode per control:

```typescript
new ParagonControls(stack, 'Controls', {
  enforce: {
    lambdaTracing: true,
    s3PublicAccess: true,
    iamWildcards: false,
  },
});
```

The two enabled controls now use Guard Hook `FAIL` mode. A `cdk deploy`, `aws cloudformation deploy`, or Cloud Control API operation that would create or update a non-compliant resource fails before that resource is provisioned.

## How Guard Hooks actually work

A CloudFormation Guard Hook is a policy registered with your AWS account. It receives resource or stack input, runs a `.guard` policy file, and returns a result to CloudFormation. In `WARN` mode, the deployment continues. In `FAIL` mode, CloudFormation blocks the operation.

This matters because the enforcement happens on the AWS side of the deployment path. A developer cannot bypass it by deploying from their laptop with admin credentials if they are still using CloudFormation, CDK, SAM, or the Cloud Control API. The main bypass is to leave those paths and call service APIs directly.

## What Paragon is not

Paragon is not a replacement for AWS Config, AWS Security Hub, or your existing detective controls. Those tools watch what already exists across your accounts. Paragon prevents specific bad states from being created on CloudFormation and Cloud Control API paths. Both layers are necessary.

Paragon is not a compliance program. Three controls do not certify you against any framework. They close three high-leverage doors.

Paragon is not a CSPM (Cloud Security Posture Management) tool. If you want continuous posture management across hundreds of resource types and full inventory awareness, use Wiz, Prisma Cloud, or AWS Security Hub directly. Paragon picks a small number of high-leverage controls and puts them on a preventive path.

## Roadmap

* **v1.1**: additional preventive controls covering RDS encryption, EBS encryption, CloudTrail enablement, and root account MFA.
* **v1.2**: a companion MCP server, `@cataio/paragon-mcp`, that lets Claude Code or any MCP-aware client list active controls, explain why a specific deployment failed, and identify existing resources that would violate a control if it were enforced today.

## License

Apache 2.0.
