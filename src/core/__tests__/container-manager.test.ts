import { ContainerManager } from '../container-manager';
import { DockerRepo } from '../interfaces/docker-repo';
import { DateTime } from 'luxon';
import config from 'config';

jest.mock('../../presentation/logging', () => ({
  getLogger: () => ({
    trace: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('container-manager', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('default constructor sets default throttle', () => {
    // Act
    const manager = new ContainerManager();

    // Assert
    expect(manager.throttle).toBeTruthy();
    expect(manager.docker).toBeTruthy();
    expect(manager.containerMetadata).toEqual({});
  });

  describe('findContainersMatchingImage', () => {
    it('returns filtered list when only image name provided', async () => {
      // Arrange
      const dockerMock = {
        listContainers: jest
          .fn()
          .mockResolvedValueOnce([
            { Image: 'imageA' },
            { Image: 'imageB' },
            { Image: 'C' },
          ]),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      const result = await manager.findContainersMatchingImage('image');

      // Assert
      expect(result).toEqual([{ Image: 'imageA' }, { Image: 'imageB' }]);
      expect(dockerMock.listContainers).toHaveBeenCalledTimes(1);
      expect(dockerMock.listContainers).toHaveBeenCalledWith(false);
    });

    it('returns filtered list when image name and onlyRunning provided', async () => {
      // Arrange
      const dockerMock = {
        listContainers: jest
          .fn()
          .mockResolvedValueOnce([
            { Image: 'imageA' },
            { Image: 'imageB' },
            { Image: 'C' },
          ]),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      const result = await manager.findContainersMatchingImage('image', {
        onlyRunning: true,
      });

      // Assert
      expect(result).toEqual([{ Image: 'imageA' }, { Image: 'imageB' }]);
      expect(dockerMock.listContainers).toHaveBeenCalledTimes(1);
      expect(dockerMock.listContainers).toHaveBeenCalledWith(true);
    });
  });

  describe('startMonitor', () => {
    it('when monitor not running starts functioning monitor', () => {
      // Arrange
      jest.useFakeTimers();
      const monitor = new ContainerManager();
      const spyHandleOrphanedContainers = jest.spyOn(
        monitor,
        'handleOrphanedContainers',
      );
      spyHandleOrphanedContainers.mockImplementation(async () => {
        /*blank*/
      });

      // Act & Assert
      expect(monitor.monitorHandle).toBeFalsy();
      monitor.startMonitor();
      expect(monitor.monitorHandle).toBeTruthy();
      jest.advanceTimersByTime(15 * 1000);
      expect(spyHandleOrphanedContainers).toHaveBeenCalledTimes(1);
    });

    it('when monitor already running does nothing', () => {
      // Arrange
      jest.useFakeTimers();
      const monitor = new ContainerManager();
      const spyHandleOrphanedContainers = jest.spyOn(
        monitor,
        'handleOrphanedContainers',
      );
      spyHandleOrphanedContainers.mockImplementation(async () => {
        /*blank*/
      });
      monitor.monitorHandle = {} as unknown as NodeJS.Timer;

      // Act & Assert
      monitor.startMonitor();
      jest.advanceTimersByTime(15 * 1000);
      expect(spyHandleOrphanedContainers).toHaveBeenCalledTimes(0);
    });
  });

  describe('stopMonitor', () => {
    it('when monitor not running does nothing', () => {
      // Arrange
      const monitor = new ContainerManager();
      const spyClearInterval = jest.spyOn(global, 'clearInterval');

      // Act & Assert
      monitor.stopMonitor();
      expect(monitor.monitorHandle).toBeFalsy();
      expect(spyClearInterval).toHaveBeenCalledTimes(0);
    });

    it('when monitor running clears monitor handle', () => {
      // Arrange
      const monitor = new ContainerManager();
      monitor.monitorHandle = {} as unknown as NodeJS.Timer;
      const spyClearInterval = jest.spyOn(global, 'clearInterval');

      // Act & Assert
      expect(monitor.monitorHandle).toBeTruthy();
      monitor.stopMonitor();
      expect(monitor.monitorHandle).toBeFalsy();
      expect(spyClearInterval).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleOrphanedContainers', () => {
    it('Removes stopped orphaned containers', async () => {
      // Arrange
      const dockerMock = {
        listContainers: jest
          .fn()
          .mockResolvedValueOnce([{ Id: 'test-id', Image: 'mds-sf-A' }]),
        getContainerInfo: jest.fn().mockResolvedValueOnce({
          State: {
            FinishedAt: '2021-01-01T00:00:00.000000000Z',
          },
        }),
        removeContainer: jest.fn().mockResolvedValueOnce(undefined),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      await expect(manager.handleOrphanedContainers()).resolves.not.toThrow();

      // Assert
      expect(dockerMock.removeContainer).toHaveBeenCalledTimes(1);
      expect(dockerMock.removeContainer).toHaveBeenCalledWith('test-id');
    });

    it('Leaves a recently stopped containers', async () => {
      // Arrange
      const dockerMock = {
        listContainers: jest
          .fn()
          .mockResolvedValueOnce([{ Id: 'test-id', Image: 'mds-sf-A' }]),
        getContainerInfo: jest.fn().mockResolvedValueOnce({
          State: {
            FinishedAt: new Date().toISOString(),
          },
        }),
        removeContainer: jest.fn().mockResolvedValueOnce(undefined),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      await expect(manager.handleOrphanedContainers()).resolves.not.toThrow();

      // Assert
      expect(dockerMock.removeContainer).toHaveBeenCalledTimes(0);
    });

    it('Stops running orphaned containers', async () => {
      // Arrange
      const dockerMock = {
        listContainers: jest
          .fn()
          .mockResolvedValueOnce([{ Id: 'test-id', Image: 'mds-sf-A' }]),
        getContainerInfo: jest.fn().mockResolvedValueOnce({
          State: {
            Running: true,
            StartedAt: '2021-01-01T00:00:00.000000000Z',
          },
        }),
        stopContainer: jest.fn().mockResolvedValueOnce(undefined),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      await expect(manager.handleOrphanedContainers()).resolves.not.toThrow();

      // Assert
      expect(dockerMock.stopContainer).toHaveBeenCalledTimes(1);
      expect(dockerMock.stopContainer).toHaveBeenCalledWith('test-id');
    });

    it('Leaves a recently running container', async () => {
      // Arrange
      const dockerMock = {
        listContainers: jest
          .fn()
          .mockResolvedValueOnce([{ Id: 'test-id', Image: 'mds-sf-A' }]),
        getContainerInfo: jest.fn().mockResolvedValueOnce({
          State: {
            Running: true,
            StartedAt: new Date().toISOString(),
          },
        }),
        stopContainer: jest.fn().mockResolvedValueOnce(undefined),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      await expect(manager.handleOrphanedContainers()).resolves.not.toThrow();

      // Assert
      expect(dockerMock.stopContainer).toHaveBeenCalledTimes(0);
    });
  });

  describe('electExistingContainerToReadyForImage', () => {
    it('when no containers available resolves undefined', async () => {
      // Arrange
      const dockerMock = {
        listContainers: jest.fn().mockResolvedValueOnce([]),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      const result =
        await manager.electExistingContainerToReadyForImage('test:image');

      // Assert
      expect(result).toBeFalsy();
    });

    it('when running container available resolves existing container id', async () => {
      // Arrange
      const dockerMock = {
        listContainers: jest
          .fn()
          .mockResolvedValueOnce([
            { Id: 'test-id', Image: 'test:latest', State: 'Running' },
          ]),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      const result =
        await manager.electExistingContainerToReadyForImage('test:latest');

      // Assert
      expect(result).toEqual('test-id');
    });

    it('when running and stopped containers available resolves running container', async () => {
      // Arrange
      const dockerMock = {
        listContainers: jest.fn().mockResolvedValueOnce([
          { Id: 'test-id', Image: 'test:latest', State: 'Exited' },
          { Id: 'test-id-2', Image: 'test:latest', State: 'Running' },
        ]),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      const result =
        await manager.electExistingContainerToReadyForImage('test:latest');

      // Assert
      expect(result).toEqual('test-id-2');
    });

    it('when stopped container available resolves stopped container', async () => {
      // Arrange
      const dockerMock = {
        listContainers: jest
          .fn()
          .mockResolvedValueOnce([
            { Id: 'test-id', Image: 'test:latest', State: 'Exited' },
          ]),
        getContainerInfo: jest.fn().mockResolvedValueOnce({
          Id: 'test-id',
          State: {
            FinishedAt: new Date().toISOString(),
          },
        }),
        startContainer: jest.fn().mockResolvedValueOnce(undefined),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      const result =
        await manager.electExistingContainerToReadyForImage('test:latest');

      // Assert
      expect(result).toEqual('test-id');
    });

    it('when stopped container not available resolves undefined', async () => {
      // Arrange
      const dockerMock = {
        listContainers: jest
          .fn()
          .mockResolvedValueOnce([
            { Id: 'test-id', Image: 'test:latest', State: 'Exited' },
          ]),
        getContainerInfo: jest.fn().mockResolvedValueOnce({
          State: {
            FinishedAt: '2021-01-01T00:00:00.000000000Z',
          },
        }),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      const result =
        await manager.electExistingContainerToReadyForImage('test:latest');

      // Assert
      expect(result).toBeFalsy();
    });

    it('when multiple stopped containers, elected container is most recent', async () => {
      // Arrange
      const now = DateTime.now();
      const dockerMock = {
        listContainers: jest.fn().mockResolvedValueOnce([
          { Id: 'test-id', Image: 'test:latest', State: 'Exited' },
          { Id: 'test-id-2', Image: 'test:latest', State: 'Exited' },
        ]),
        getContainerInfo: jest
          .fn()
          .mockResolvedValueOnce({
            Id: 'test-id-1',
            State: {
              FinishedAt: now.minus({ second: 30 }).toISO(),
            },
          })
          .mockResolvedValueOnce({
            Id: 'test-id-2',
            State: {
              FinishedAt: now.minus({ second: 10 }).toISO(),
            },
          }),
        startContainer: jest.fn().mockResolvedValueOnce(undefined),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      const result =
        await manager.electExistingContainerToReadyForImage('test:latest');

      // Assert
      expect(result).toEqual('test-id-2');
    });
  });

  describe('readyFunctionContainerForImage', () => {
    it('when no existing container starts new container and returns metadata', async () => {
      // Arrange
      const now = DateTime.now();
      const dockerMock = {
        listContainers: jest.fn().mockResolvedValueOnce([]),
        getContainerInfo: jest.fn().mockResolvedValueOnce({
          Id: 'test-id',
          State: {
            StartedAt: now.minus({ second: 1 }).toISO(),
          },
          NetworkSettings: {
            IPAddress: 'testIpAddress',
          },
        }),
        createContainer: jest.fn().mockResolvedValue('test-id'),
        startContainer: jest.fn().mockResolvedValueOnce(undefined),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      const result = await manager.readyFunctionContainerForImage(
        'test',
        'latest',
      );

      // Assert
      expect(result).toEqual({ handle: 'test-id', ip: 'testIpAddress' });
      expect(dockerMock.createContainer).toHaveBeenCalledTimes(1);
      expect(dockerMock.createContainer).toHaveBeenCalledWith({
        image: 'test:latest',
        name: expect.stringContaining('mds-sf-'),
        networkMode: 'bridge',
      });
      expect(dockerMock.startContainer).toHaveBeenCalledTimes(1);
      expect(dockerMock.startContainer).toHaveBeenCalledWith('test-id');
    });

    it('when existing container available returns metadata', async () => {
      // Arrange
      const now = DateTime.now();
      const dockerMock = {
        listContainers: jest
          .fn()
          .mockResolvedValueOnce([
            { Id: 'test-id', Image: 'test:latest', State: 'Running' },
          ]),
        getContainerInfo: jest.fn().mockResolvedValueOnce({
          Id: 'test-id',
          State: {
            StartedAt: now.minus({ second: 1 }).toISO(),
          },
          NetworkSettings: {
            IPAddress: 'testIpAddress',
          },
        }),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      const result = await manager.readyFunctionContainerForImage(
        'test',
        'latest',
      );

      // Assert
      expect(result).toEqual({ handle: 'test-id', ip: 'testIpAddress' });
    });

    it('when existing container available with custom network returns metadata', async () => {
      // Arrange
      const now = DateTime.now();
      const origConfig = jest.requireActual('config');
      const fakeConfig = {
        has: (key: string) => {
          if (key === 'containerNetwork') return true;
          return origConfig.has(key) as boolean;
        },
        get: (key: string) => {
          if (key === 'containerNetwork') return 'testing-network';
          return origConfig.get(key) as string;
        },
        util: origConfig.util,
      };
      const dockerMock = {
        listContainers: jest
          .fn()
          .mockResolvedValueOnce([
            { Id: 'test-id', Image: 'test:latest', State: 'Running' },
          ]),
        getContainerInfo: jest.fn().mockResolvedValueOnce({
          Id: 'test-id',
          State: {
            StartedAt: now.minus({ second: 1 }).toISO(),
          },
          NetworkSettings: {
            Networks: {
              'testing-network': {
                IPAddress: 'testIpAddress',
              },
            },
          },
        }),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
        conf: fakeConfig as config.IConfig,
      });
      const result = await manager.readyFunctionContainerForImage(
        'test',
        'latest',
      );

      // Assert
      expect(result).toEqual({ handle: 'test-id', ip: 'testIpAddress' });
    });

    it('when error occurs retries and returns metadata', async () => {
      // Arrange
      const now = DateTime.now();
      const dockerMock = {
        listContainers: jest
          .fn()
          .mockRejectedValueOnce(new Error('test error'))
          .mockResolvedValueOnce([
            { Id: 'test-id', Image: 'test:latest', State: 'Running' },
          ]),
        getContainerInfo: jest.fn().mockResolvedValueOnce({
          Id: 'test-id',
          State: {
            StartedAt: now.minus({ second: 1 }).toISO(),
          },
          NetworkSettings: {
            IPAddress: 'testIpAddress',
          },
        }),
      };

      // Act
      const manager = new ContainerManager({
        dockerRepo: dockerMock as unknown as DockerRepo,
      });
      const result = await manager.readyFunctionContainerForImage(
        'test',
        'latest',
      );

      // Assert
      expect(result).toEqual({ handle: 'test-id', ip: 'testIpAddress' });
    });
  });

  describe('releaseFunctionContainer', () => {
    it('reduces the open call count of the metadata', () => {
      // Arrange
      const manager = new ContainerManager();
      const testMeta = {
        openCalls: 2,
        lastCall: DateTime.now(),
        image: 'test',
        ip: '',
      };
      manager.containerMetadata = {
        test: testMeta,
      };

      // Act
      manager.releaseFunctionContainer('test');

      // Assert
      expect(manager.containerMetadata.test).toEqual({
        ...testMeta,
        openCalls: 1,
      });
    });

    it('does not reduce the number of open calls below zero', () => {
      // Arrange
      const manager = new ContainerManager();
      const testMeta = {
        openCalls: 0,
        lastCall: DateTime.now(),
        image: 'test',
        ip: '',
      };
      manager.containerMetadata = {
        test: testMeta,
      };

      // Act
      manager.releaseFunctionContainer('test');

      // Assert
      expect(manager.containerMetadata.test).toEqual({
        ...testMeta,
        openCalls: 0,
      });
    });
  });
});
