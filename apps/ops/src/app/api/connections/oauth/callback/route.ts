import { credentialKeyConfigFromEnvironment, exchangeOAuthCode, productionHttpTransport } from '@sartre/connectors'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { connectTool, getManifest } from '@/lib/data'
import { handleOAuthCallback } from '@/lib/oauth-callback'

export async function GET(request: Request): Promise<Response> {
  return handleOAuthCallback(request, {
    encryptionKey: credentialKeyConfigFromEnvironment(process.env),
    getIdentity: getPortalIdentity,
    assertAccess: (identity, clientId) => assertClientAccess(identity as Awaited<ReturnType<typeof getPortalIdentity>>, clientId, 'connect'),
    getManifest,
    exchange: (provider, input) => exchangeOAuthCode(provider, input, productionHttpTransport()),
    connect: connectTool,
  })
}
