import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument, type Scalar } from 'yaml';

const AUTH_TEMPLATE_PATH = path.resolve(
  __dirname,
  '../../../infrastructure/auth/template.yaml',
);

type CfnResource = {
  Type?: string;
  Properties?: Record<string, unknown>;
};

export type AuthCfnTemplate = {
  Resources?: Record<string, CfnResource>;
};

function scalarSource(source: Scalar): string {
  if (typeof source.value === 'string') {
    return source.value;
  }

  return String(source.source ?? source.toString());
}

const CLOUDFORMATION_CUSTOM_TAGS = [
  {
    tag: '!Ref',
    resolve(source: Scalar) {
      return { Ref: scalarSource(source) };
    },
  },
  {
    tag: '!Sub',
    resolve(source: Scalar) {
      return { Sub: scalarSource(source) };
    },
  },
  {
    tag: '!GetAtt',
    resolve(source: Scalar) {
      return { GetAtt: scalarSource(source) };
    },
  },
];

export function loadAuthTemplate(): AuthCfnTemplate {
  const text = readFileSync(AUTH_TEMPLATE_PATH, 'utf8');
  const doc = parseDocument(text, {
    // CloudFormation intrinsic tags (!Ref, !Sub, !GetAtt)
    customTags: CLOUDFORMATION_CUSTOM_TAGS as never,
  });

  if (doc.errors.length > 0) {
    throw new Error(
      `Failed to parse auth template: ${doc.errors.map((error) => error.message).join('; ')}`,
    );
  }

  const json = doc.toJSON() as AuthCfnTemplate;

  if (!json.Resources || typeof json.Resources !== 'object') {
    throw new Error('Auth template is missing Resources map.');
  }

  return json;
}

export function requireResourceProperties(
  template: AuthCfnTemplate,
  logicalId: string,
): Record<string, unknown> {
  const resource = template.Resources?.[logicalId];

  if (!resource) {
    throw new Error(`Resource ${logicalId} is not defined in auth template.`);
  }

  if (!resource.Properties || typeof resource.Properties !== 'object') {
    throw new Error(`Resource ${logicalId} is missing Properties.`);
  }

  return resource.Properties;
}
