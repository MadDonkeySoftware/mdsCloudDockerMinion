import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import { fastifyAwilixPlugin, diContainer, Cradle } from '@fastify/awilix';
import multipart from '@fastify/multipart';
import config from 'config';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { rootRouter } from './routes';
import { AwilixContainer } from 'awilix';
import { Logic } from '../core/logic';
import { initialize } from './logging';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { diContainerInit } from './di-container-init';

export async function buildApp(
  dependencyInjectionOverride?: ({
    diContainer,
    server,
  }: {
    diContainer: AwilixContainer<Cradle>;
    server: FastifyInstance;
  }) => void,
) {
  // Note: The object coming out of the config is immutable. We spread into
  // a new object so that fastify can modify the object internally as it expects
  // to do.
  const fastifyOptions: FastifyServerOptions = {
    ...config.get<FastifyServerOptions>('fastifyOptions'),
  };
  const server = fastify(fastifyOptions);
  server.withTypeProvider<TypeBoxTypeProvider>();

  if (config.get<boolean>('enableSwagger')) {
    server.register(fastifySwagger, {
      swagger: {
        produces: ['application/json'],
        consumes: ['application/json'],
      },
    });

    server.register(fastifySwaggerUi, {
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
      },
    });
  }

  server.register(fastifyAwilixPlugin, {
    disposeOnClose: true,
    disposeOnResponse: true,
  });

  if (dependencyInjectionOverride) {
    dependencyInjectionOverride({ diContainer, server });
  } else {
    diContainerInit({ diContainer, server });
  }

  await server.register(multipart);
  await server.register(rootRouter);

  server.addHook('onRequest', (request, reply, done) => {
    request.services = {
      get logic() {
        return request.diScope.resolve<Logic>('logic');
      },
    };

    done();
  });

  // TODO: Should this live here
  initialize(server.log);

  return server;
}
