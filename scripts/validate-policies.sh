#!/usr/bin/env bash
set -euo pipefail

CFN_GUARD_BIN="${CFN_GUARD_BIN:-cfn-guard}"

pass() {
  "$CFN_GUARD_BIN" validate --rules "$1" --data "$2" --type CFNTemplate --show-summary none
}

fail() {
  if "$CFN_GUARD_BIN" validate --rules "$1" --data "$2" --type CFNTemplate --show-summary none >/tmp/paragon-cfn-guard-expected-fail.log 2>&1; then
    echo "Expected validation to fail: $1 against $2" >&2
    exit 1
  fi
}

pass policies/lambda-tracing.guard test/fixtures/lambda-pass.yaml
fail policies/lambda-tracing.guard test/fixtures/lambda-fail.yaml

pass policies/s3-public-access.guard test/fixtures/s3-pass.yaml
fail policies/s3-public-access.guard test/fixtures/s3-fail.yaml

pass policies/iam-wildcards.guard test/fixtures/iam-pass.yaml
fail policies/iam-wildcards.guard test/fixtures/iam-fail.yaml

echo "Guard policy fixtures passed."
