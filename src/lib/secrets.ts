import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();

export async function getSecret(projectId: string, secretId: string): Promise<string> {
  const [version] = await client.accessSecretVersion({
    name: `projects/${projectId}/secrets/${secretId}/versions/latest`,
  });
  const data = version.payload?.data;
  if (!data) throw new Error(`Secret ${secretId} has no payload`);
  return typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
}
