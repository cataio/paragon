import { App, Stack } from 'aws-cdk-lib';
import { ParagonControls } from '../../../src';

const app = new App();
const stack = new Stack(app, 'ParagonExampleStack');

new ParagonControls(stack, 'Controls', {
  enforce: {
    lambdaTracing: false,
    s3PublicAccess: false,
    iamWildcards: false,
  },
});
