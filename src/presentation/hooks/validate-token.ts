import config from 'config';
import { FastifyReply, FastifyRequest } from 'fastify';
import { MdsSdk } from '@maddonkeysoftware/mds-cloud-sdk-node';
import { verify } from 'jsonwebtoken';
import { getLogger } from '../logging';
import { IdentityJwt } from '../types/identity-jwt';

export async function ValidateToken(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const logger = getLogger();
  const token = request.headers.token as string | undefined;
  if (!token) {
    reply.status(403);
    reply.header('content-type', 'text/plain');
    reply.send('Please include authentication token in header "token"');
    throw new Error('Missing Authentication Token');
  }

  let parsedToken: IdentityJwt | undefined;
  try {
    const publicSignature = await (
      await MdsSdk.getIdentityServiceClient()
    ).getPublicSignature();
    parsedToken = verify(token, publicSignature.signature, {
      complete: true,
    }) as IdentityJwt;
  } catch (err) {
    logger.debug({ err }, 'Error detected while parsing token.');
    reply.status(403);
    reply.send();
    throw err;
  }

  if (
    parsedToken &&
    parsedToken.payload.iss === config.get<string>('oridProviderKey')
  ) {
    request.parsedToken = parsedToken;
  } else {
    if (logger) {
      logger.debug({ token: parsedToken }, 'Invalid token detected.');
      reply.status(403);
      reply.send();
      throw new Error('Invalid Authentication Token');
    }
  }
}
