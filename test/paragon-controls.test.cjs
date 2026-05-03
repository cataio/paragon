const cdk = require('aws-cdk-lib');
const { Match, Template } = require('aws-cdk-lib/assertions');
const { ParagonControls } = require('../lib');

describe('ParagonControls', () => {
  test('synthesizes three report-only Guard Hooks by default', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    new ParagonControls(stack, 'Controls');

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CloudFormation::GuardHook', 3);
    template.hasResourceProperties('AWS::CloudFormation::GuardHook', {
      FailureMode: 'WARN',
      HookStatus: 'ENABLED',
      TargetOperations: ['RESOURCE', 'STACK', 'CLOUD_CONTROL'],
      TargetFilters: {
        Targets: Match.arrayWith([
          {
            Action: 'CREATE',
            InvocationPoint: 'PRE_PROVISION',
            TargetName: Match.anyValue(),
          },
        ]),
      },
    });
  });

  test('supports per-control enforcement', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    new ParagonControls(stack, 'Controls', {
      enforce: {
        lambdaTracing: true,
        s3PublicAccess: false,
        iamWildcards: false,
      },
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFormation::GuardHook', {
      Alias: 'Cataio::Paragon::LambdaTracing',
      FailureMode: 'FAIL',
    });
    template.hasResourceProperties('AWS::CloudFormation::GuardHook', {
      Alias: 'Cataio::Paragon::S3PublicAccess',
      FailureMode: 'WARN',
    });
  });

  test('allows installing a subset of controls', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    new ParagonControls(stack, 'Controls', {
      controls: ['s3PublicAccess'],
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CloudFormation::GuardHook', 1);
    template.hasResourceProperties('AWS::CloudFormation::GuardHook', {
      Alias: 'Cataio::Paragon::S3PublicAccess',
    });
  });

  test('creates private buckets for policies and Guard output', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    new ParagonControls(stack, 'Controls');

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: Match.objectLike({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      }),
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
    });
  });
});
