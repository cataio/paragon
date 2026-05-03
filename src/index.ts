import * as path from 'path';
import { Names, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cloudformation from 'aws-cdk-lib/aws-cloudformation';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export type ParagonControl = 'lambdaTracing' | 's3PublicAccess' | 'iamWildcards';

export interface ParagonControlsProps {
  /**
   * Controls to register. Defaults to all controls.
   */
  readonly controls?: readonly ParagonControl[];

  /**
   * Enforcement mode. Defaults to report-only for every control.
   *
   * - false or omitted: every control uses WARN
   * - true: every control uses FAIL
   * - object: choose FAIL per control
   */
  readonly enforce?: boolean | Partial<Record<ParagonControl, boolean>>;

  /**
   * Optional bucket where Paragon uploads the bundled Guard rule files.
   * If omitted, Paragon creates a private S3 bucket.
   */
  readonly policyBucket?: s3.IBucket;

  /**
   * Optional bucket where CloudFormation writes detailed Guard output.
   * If omitted, Paragon creates a private S3 bucket.
   */
  readonly logBucket?: s3.IBucket;

  /**
   * S3 prefix used for bundled Guard rule files.
   *
   * @default paragon/guard-rules
   */
  readonly policyPrefix?: string;

  /**
   * Optional stack filters for the Guard Hooks.
   *
   * By default, Paragon excludes the stack that installs Paragon so the
   * bootstrap resources are not evaluated by the hooks they are creating.
   */
  readonly stackFilters?: cloudformation.CfnGuardHook.StackFiltersProperty;

  /**
   * Hook target operations.
   *
   * @default ['RESOURCE', 'STACK', 'CLOUD_CONTROL']
   */
  readonly targetOperations?: readonly string[];

  /**
   * Optional path to Guard policy files. Intended for tests and forks.
   */
  readonly policyDirectory?: string;
}

export interface ParagonHook {
  readonly control: ParagonControl;
  readonly hook: cloudformation.CfnGuardHook;
}

interface ControlDefinition {
  readonly control: ParagonControl;
  readonly alias: string;
  readonly fileName: string;
  readonly targetNames: readonly string[];
}

const CONTROL_DEFINITIONS: readonly ControlDefinition[] = [
  {
    control: 'lambdaTracing',
    alias: 'LambdaTracing',
    fileName: 'lambda-tracing.guard',
    targetNames: ['AWS::Lambda::Function'],
  },
  {
    control: 's3PublicAccess',
    alias: 'S3PublicAccess',
    fileName: 's3-public-access.guard',
    targetNames: ['AWS::S3::Bucket'],
  },
  {
    control: 'iamWildcards',
    alias: 'IamWildcards',
    fileName: 'iam-wildcards.guard',
    targetNames: [
      'AWS::IAM::Policy',
      'AWS::IAM::ManagedPolicy',
      'AWS::IAM::Role',
      'AWS::IAM::User',
      'AWS::IAM::Group',
    ],
  },
];

export class ParagonControls extends Construct {
  public readonly policyBucket: s3.IBucket;
  public readonly logBucket: s3.IBucket;
  public readonly hooks: readonly ParagonHook[];

  public constructor(scope: Construct, id: string, props: ParagonControlsProps = {}) {
    super(scope, id);

    const stack = Stack.of(this);
    const policyPrefix = trimSlashes(props.policyPrefix ?? 'paragon/guard-rules');
    const policyDirectory = props.policyDirectory ?? path.join(__dirname, '..', 'policies');

    this.policyBucket = props.policyBucket ?? new s3.Bucket(this, 'PolicyBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.logBucket = props.logBucket ?? new s3.Bucket(this, 'LogBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const deployment = new s3deploy.BucketDeployment(this, 'PolicyDeployment', {
      sources: [s3deploy.Source.asset(policyDirectory)],
      destinationBucket: this.policyBucket,
      destinationKeyPrefix: policyPrefix,
    });

    const executionRole = new iam.Role(this, 'GuardHookExecutionRole', {
      assumedBy: new iam.ServicePrincipal('hooks.cloudformation.amazonaws.com'),
      description: 'Execution role used by Paragon CloudFormation Guard Hooks.',
    });

    this.policyBucket.grantRead(executionRole);
    this.logBucket.grantPut(executionRole);

    const selectedControls = new Set(props.controls ?? CONTROL_DEFINITIONS.map((definition) => definition.control));
    const stackFilters = props.stackFilters ?? {
      filteringCriteria: 'ALL',
      stackNames: {
        exclude: [stack.stackName],
      },
    };

    this.hooks = CONTROL_DEFINITIONS
      .filter((definition) => selectedControls.has(definition.control))
      .map((definition) => {
        const hook = new cloudformation.CfnGuardHook(this, `${definition.alias}Hook`, {
          alias: `Cataio::Paragon::${definition.alias}`,
          executionRole: executionRole.roleArn,
          failureMode: isEnforced(props.enforce, definition.control) ? 'FAIL' : 'WARN',
          hookStatus: 'ENABLED',
          logBucket: this.logBucket.bucketName,
          ruleLocation: {
            uri: `s3://${this.policyBucket.bucketName}/${policyPrefix}/${definition.fileName}`,
          },
          stackFilters,
          targetFilters: {
            targets: guardTargets(definition.targetNames),
          },
          targetOperations: [...(props.targetOperations ?? ['RESOURCE', 'STACK', 'CLOUD_CONTROL'])],
        });

        hook.node.addDependency(deployment);

        return {
          control: definition.control,
          hook,
        };
      });

    this.node.addMetadata('paragon:controls', [...selectedControls].join(','));
    this.node.addMetadata('paragon:policyAssetHash', Names.uniqueId(deployment));
  }
}

function isEnforced(
  enforce: ParagonControlsProps['enforce'],
  control: ParagonControl,
): boolean {
  if (enforce === true) {
    return true;
  }

  if (!enforce) {
    return false;
  }

  return enforce[control] === true;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function guardTargets(targetNames: readonly string[]): cloudformation.CfnGuardHook.HookTargetProperty[] {
  return targetNames.flatMap((targetName) => [
    {
      action: 'CREATE',
      invocationPoint: 'PRE_PROVISION',
      targetName,
    },
    {
      action: 'UPDATE',
      invocationPoint: 'PRE_PROVISION',
      targetName,
    },
  ]);
}
