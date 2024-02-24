import { asFunction, AwilixContainer, Lifetime } from 'awilix';

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
import { Cradle } from '@fastify/awilix';
import { ContainerManager } from '../core/container-manager';
import { Logic } from '../core/logic';
import { FastifyInstance } from 'fastify';

export function defaultDependencyInjection(
  diContainer: AwilixContainer<Cradle>,
) {
  // We define this outside of the registration functions since the functions
  // execute the first time the item is requested.
  const manager = new ContainerManager();
  manager.startMonitor();

  // Wire things up!
  diContainer.register({
    containerManager: asFunction(
      () => {
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
