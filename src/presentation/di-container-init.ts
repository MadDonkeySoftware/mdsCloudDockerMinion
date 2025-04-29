import { Cradle } from '@fastify/awilix';
import { asFunction, AwilixContainer, Lifetime } from 'awilix';
import { FastifyInstance } from 'fastify';
import { ContainerManager } from '../core/container-manager';
import { Logic } from '../core/logic';

export function diContainerInit({
  diContainer,
  server,
}: {
  diContainer: AwilixContainer<Cradle>;
  server: FastifyInstance;
}) {
  // Wire things up!
  diContainer.register({
    logger: asFunction(
      () => {
        return server.log;
      },
      {
        lifetime: Lifetime.SINGLETON,
      },
    ),

    containerManager: asFunction(
      () => {
        const manager = new ContainerManager();
        return manager;
      },
      {
        lifetime: Lifetime.SINGLETON,
        dispose: (containerManager) => {
          containerManager.stopMonitor();
        },
      },
    ),
    logic: asFunction(
      ({ containerManager }) => {
        return new Logic({ containerManager });
      },
      {
        lifetime: Lifetime.SCOPED,
      },
    ),
  });
}
