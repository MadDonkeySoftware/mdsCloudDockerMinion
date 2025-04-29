import { BaseLogger } from 'pino';
import { MdsSdk } from '@maddonkeysoftware/mds-cloud-sdk-node';
import { IdentityServiceClient } from '@maddonkeysoftware/mds-cloud-sdk-node/clients';
import { Logic } from '../logic';
import { FunctionsRepo } from '../interfaces/functions-repo';
import { ContainerManager } from '../container-manager';
import { GrpcClient } from '../../infrastructure/grpc/client';
import { DockerRepo } from '../interfaces/docker-repo';
import * as runtimeTools from '../runtimeTools';
import * as tarFs from 'tar-fs';
import * as dns from 'dns/promises';
import config from 'config';

jest.mock('jsonwebtoken', () => ({
  decode: jest.fn().mockResolvedValue({
    userId: 'test-user-id',
  }),
}));

jest.mock('@maddonkeysoftware/mds-cloud-sdk-node');
const mockMdsSdk = jest.mocked(MdsSdk);

jest.mock('../runtimeTools');
const mockRuntimeTools = jest.mocked(runtimeTools);

jest.mock('tar-fs');
const mockTarFs = jest.mocked(tarFs);

let fakeRegistryAddress: string | undefined;
jest.mock('config', () => {
  const originalConfig = jest.requireActual('config');
  return {
    has: jest.fn((key: string) => {
      if (key === 'registry.address') return Boolean(fakeRegistryAddress);
      return originalConfig.has(key);
    }),
    get: jest.fn((key: string) => {
      if (key === 'registry.address') return fakeRegistryAddress;
      return originalConfig.get(key);
    }),
  };
});
const mockConfig = jest.mocked(config);

jest.mock('dns/promises');
const mockDns = jest.mocked(dns);

const fakeLogger = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
};

// TODO (issue-24): tests for building, executing, etc against the docker socket
// fail on CI. Bypassing these tests for now until a re-write of this package
// is done.
describe.skip('logic', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe('getContainerHost', () => {
    it('resolves empty string when environment variable missing', async () => {
      // Arrange
      fakeRegistryAddress = undefined;
      const logic = new Logic();

      // Act
      const result = await logic.getContainerHost();

      // Assert
      expect(result).toEqual('');
    });

    it('resolves with port 80 when no port specified', async () => {
      // Arrange
      fakeRegistryAddress = '1.2.3.4';
      const logic = new Logic();

      // Act
      const result = await logic.getContainerHost();

      // Assert
      expect(result).toEqual('1.2.3.4:80/');
    });

    it('resolves cached container host when called multiple times', async () => {
      fakeRegistryAddress = '1.2.3.4:5678';
      const logic = new Logic();

      // Act
      const result = await logic.getContainerHost();
      const result2 = await logic.getContainerHost();

      // Assert
      expect(result).toEqual('1.2.3.4:5678/');
      expect(result2).toEqual(result);
      expect(mockConfig.get).toHaveBeenCalledTimes(1);
    });

    it('resolves ip address of host when dns name used', async () => {
      fakeRegistryAddress = 'someHost:5678';
      mockDns.lookup.mockResolvedValueOnce({ address: '1.2.3.4', family: -1 });
      const logic = new Logic();

      // Act
      const result = await logic.getContainerHost();

      // Assert
      expect(result).toEqual('1.2.3.4:5678/');
    });

    it('resolves setting value when dns lookup fails', async () => {
      fakeRegistryAddress = 'someHost:5678';
      mockDns.lookup.mockRejectedValueOnce(new Error('test error'));
      const logic = new Logic({
        logger: fakeLogger as unknown as BaseLogger,
      });

      // Act
      const result = await logic.getContainerHost();

      // Assert
      expect(result).toEqual('someHost:5678/');
    });
  });

  describe('buildImage', () => {
    it('when build is success resolves with expected data', async () => {
      // Arrange
      mockTarFs.pack.mockReturnValue(
        Buffer.from('tar-stream') as unknown as tarFs.Pack,
      );
      const fakeRepo = {
        buildImage: jest.fn().mockResolvedValueOnce(undefined),
      };
      const logic = new Logic({
        dockerRepo: fakeRepo as unknown as DockerRepo,
        logger: fakeLogger as unknown as BaseLogger,
      });
      logic.getContainerHost = jest
        .fn()
        .mockResolvedValueOnce('container-host/');

      // Act
      const result = await logic.buildImage('local/path', {
        id: 'func-id',
        accountId: 'account-id',
        name: 'test-func',
        nextVersion: 2,
        maxProcesses: 3,
        created: 'now',
      });

      // Assert
      expect(result).toEqual({
        containerHost: 'container-host/',
        fullTagName: 'container-host/mds-sf-account-id/test-func',
        functionName: 'test-func',
        tagVersion: '2',
      });
      expect(fakeRepo.buildImage).toHaveBeenCalledTimes(1);
    });

    it('when build fails rejects', async () => {
      // Arrange
      mockTarFs.pack.mockReturnValue(
        Buffer.from('tar-stream') as unknown as tarFs.Pack,
      );
      const fakeRepo = {
        buildImage: jest.fn().mockRejectedValueOnce(new Error('test error')),
      };
      const logic = new Logic({
        dockerRepo: fakeRepo as unknown as DockerRepo,
        logger: fakeLogger as unknown as BaseLogger,
      });
      logic.getContainerHost = jest
        .fn()
        .mockResolvedValueOnce('container-host/');

      // Act & Assert
      await expect(
        logic.buildImage('local/path', {
          id: 'func-id',
          accountId: 'account-id',
          name: 'test-func',
          nextVersion: 2,
          maxProcesses: 3,
          created: 'now',
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Failed to build docker image."`,
      );
      expect(fakeLogger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('pushImageToRegistry', () => {
    it('forwards request to repository', async () => {
      // Arrange
      const fakeRepo = {
        pushImage: jest.fn().mockResolvedValueOnce(undefined),
      };
      const logic = new Logic({
        dockerRepo: fakeRepo as unknown as DockerRepo,
      });

      // Act & Assert
      await expect(
        logic.pushImageToRegistry({
          fullTagName: 'tag/name',
          tagVersion: 'tag-version',
          containerHost: 'host',
          functionName: 'name',
        }),
      ).resolves.not.toThrow();
      expect(fakeRepo.pushImage).toHaveBeenCalledTimes(1);
      expect(fakeRepo.pushImage).toHaveBeenCalledWith(
        'tag/name',
        'tag-version',
      );
    });
  });

  describe('removeImageLocally', () => {
    it('when successful no log message', async () => {
      // Arrange
      const fakeRepo = {
        removeLocalImage: jest.fn().mockResolvedValueOnce(undefined),
      };
      const logic = new Logic({
        dockerRepo: fakeRepo as unknown as DockerRepo,
        logger: fakeLogger as unknown as BaseLogger,
      });

      // Act
      await logic.removeImageLocally({
        fullTagName: 'full/tag',
        tagVersion: 'tag-version',
      });

      // Assert
      expect(fakeRepo.removeLocalImage).toHaveBeenCalledTimes(1);
      expect(fakeRepo.removeLocalImage).toHaveBeenCalledWith(
        'full/tag',
        'tag-version',
      );
      expect(fakeLogger.warn).toHaveBeenCalledTimes(0);
    });

    it('when issue occurs logs issue', async () => {
      // Arrange
      const fakeRepo = {
        removeLocalImage: jest
          .fn()
          .mockRejectedValueOnce(new Error('test error')),
      };
      const logic = new Logic({
        dockerRepo: fakeRepo as unknown as DockerRepo,
        logger: fakeLogger as unknown as BaseLogger,
      });

      // Act
      await logic.removeImageLocally({
        fullTagName: 'full/tag',
        tagVersion: 'tag-version',
      });

      // Assert
      expect(fakeRepo.removeLocalImage).toHaveBeenCalledTimes(1);
      expect(fakeRepo.removeLocalImage).toHaveBeenCalledWith(
        'full/tag',
        'tag-version',
      );
      expect(fakeLogger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('createFunction', () => {
    it('when function created returns proper response', async () => {
      // Arrange
      const fakeRepo = {
        createFunction: jest.fn().mockResolvedValueOnce('function-id'),
      };
      const logic = new Logic({
        functionsRepo: fakeRepo as unknown as FunctionsRepo,
      });

      // Act
      const result = await logic.createFunction({
        name: 'test-function',
        accountId: 'test-account',
      });

      // Assert
      expect(result).toEqual({
        exists: false,
        id: 'function-id',
      });
      expect(fakeRepo.createFunction).toHaveBeenCalledTimes(1);
      expect(fakeRepo.createFunction).toHaveBeenCalledWith({
        name: 'test-function',
        accountId: 'test-account',
      });
    });

    it('when function exists returns proper response', async () => {
      // Arrange
      const fakeRepo = {
        createFunction: jest.fn().mockResolvedValueOnce(null),
      };
      const logic = new Logic({
        functionsRepo: fakeRepo as unknown as FunctionsRepo,
      });

      // Act
      const result = await logic.createFunction({
        name: 'test-function',
        accountId: 'test-account',
      });

      // Assert
      expect(result).toEqual({
        exists: true,
        id: null,
      });
      expect(fakeRepo.createFunction).toHaveBeenCalledTimes(1);
      expect(fakeRepo.createFunction).toHaveBeenCalledWith({
        name: 'test-function',
        accountId: 'test-account',
      });
    });
  });

  describe('listFunction', () => {
    it('forwards request to repository', async () => {
      // Arrange
      const fakeRepo = {
        listFunctions: jest.fn().mockResolvedValueOnce(undefined),
      };
      const logic = new Logic({
        functionsRepo: fakeRepo as unknown as FunctionsRepo,
      });

      // Act
      await logic.listFunctions();

      // Assert
      expect(fakeRepo.listFunctions).toHaveBeenCalledTimes(1);
      expect(fakeRepo.listFunctions).toHaveBeenCalledWith();
    });
  });

  describe('buildFunction', () => {
    const eventData = {
      functionId: 'testFuncId',
      localFilePath: '/tmp/abcdef',
      runtime: 'testRuntime',
      entryPoint: 'src/index:main',
    };

    it('updates data store and provider successfully when function exists', async () => {
      // Arrange
      mockRuntimeTools.getRuntimeTools.mockReturnValueOnce({
        prepSourceForContainerBuild: jest.fn().mockResolvedValueOnce(undefined),
        findEntrypoint: jest.fn().mockResolvedValueOnce(undefined),
      });
      const fakeRepo = {
        getFunctionInfo: jest.fn().mockResolvedValueOnce({}),
        updateFunctionInfo: jest.fn().mockResolvedValueOnce(undefined),
      };
      const fakeSourceRepo = {
        extractSource: jest.fn().mockResolvedValueOnce('/tmp/sourcePath'),
        cleanupSource: jest.fn().mockResolvedValueOnce(undefined),
      };
      const logic = new Logic({
        functionsRepo: fakeRepo as unknown as FunctionsRepo,
        logger: fakeLogger as unknown as BaseLogger,
        sourceRepo: fakeSourceRepo,
      });
      logic.pushImageToRegistry = jest.fn().mockResolvedValueOnce(undefined);
      logic.buildImage = jest.fn().mockResolvedValueOnce({
        containerHost: 'container-host',
        fullTagName: 'full/tag-name',
        tagVersion: 'tag-version',
      });

      // Act & Assert
      await expect(logic.buildFunction(eventData)).resolves.not.toThrow();
      expect(fakeRepo.updateFunctionInfo).toHaveBeenCalledTimes(1);
      expect(fakeRepo.updateFunctionInfo).toHaveBeenCalledWith({
        containerHost: 'container-host',
        fullTagName: 'full/tag-name',
        id: 'testFuncId',
        incrementVersion: true,
        lastUpdate: expect.any(String),
        tagVersion: 'tag-version',
      });
    });

    it('logs and throws when error occurs', async () => {
      // Arrange
      mockRuntimeTools.getRuntimeTools.mockImplementationOnce(() => {
        throw new Error('test error');
      });
      const fakeFuncRepo = {
        getFunctionInfo: jest.fn().mockResolvedValueOnce({}),
      };
      const fakeSourceRepo = {
        extractSource: jest.fn().mockResolvedValueOnce('/tmp/sourcePath'),
        cleanupSource: jest.fn().mockResolvedValueOnce(undefined),
      };
      const logic = new Logic({
        functionsRepo: fakeFuncRepo as unknown as FunctionsRepo,
        logger: fakeLogger as unknown as BaseLogger,
        sourceRepo: fakeSourceRepo,
      });

      // Act & Assert
      await expect(
        logic.buildFunction(eventData),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"test error"`);
    });

    it('raises error when function does not exist', async () => {
      // Arrange
      const fakeRepo = {
        getFunctionInfo: jest
          .fn()
          .mockRejectedValueOnce(new Error('Could not find function')),
      };
      const fakeSourceRepo = {
        extractSource: jest.fn().mockResolvedValueOnce('/tmp/sourcePath'),
        cleanupSource: jest.fn().mockResolvedValueOnce(undefined),
      };
      const logic = new Logic({
        functionsRepo: fakeRepo as unknown as FunctionsRepo,
        logger: fakeLogger as unknown as BaseLogger,
        sourceRepo: fakeSourceRepo,
      });

      // Act & Assert
      await expect(
        logic.buildFunction(eventData),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Could not find function"`);
    });
  });

  describe('executeFunction', () => {
    describe('returns expected result', () => {
      const fakeContainerManager = {
        readyFunctionContainerForImage: jest.fn().mockResolvedValue({
          ip: 'test-ip',
          handle: 'test-handle',
        }),
        releaseFunctionContainer: jest.fn(),
      };
      const fakeRepo = {
        getFunctionInfo: jest.fn().mockResolvedValue({
          fullTagName: 'test/tag',
          tagVersion: '1',
          accountId: '1001',
        }),
      };

      it('when function exists call function and returns result', async () => {
        // Arrange
        mockMdsSdk.getIdentityServiceClient.mockResolvedValue({
          impersonateUser: jest.fn().mockResolvedValue({ token: 'test' }),
        } as unknown as IdentityServiceClient);
        const fakeGrpcClient = {
          invoke: jest.fn().mockResolvedValue({ foo: 'bar' }),
        };
        const logic = new Logic({
          containerManager: fakeContainerManager as unknown as ContainerManager,
          functionsRepo: fakeRepo as unknown as FunctionsRepo,
          grpcClient: fakeGrpcClient as unknown as GrpcClient,
          logger: fakeLogger as unknown as BaseLogger,
        });

        // Act
        const result = await logic.executeFunction(
          'test-id',
          JSON.stringify({ baz: 1 }),
        );

        // Assert
        expect(result).toEqual({ foo: 'bar' });
        expect(fakeGrpcClient.invoke).toHaveBeenCalledTimes(1);
      });

      it('when function call errors with retry-able error retries and returns result', async () => {
        // Arrange
        mockMdsSdk.getIdentityServiceClient.mockResolvedValue({
          impersonateUser: jest.fn().mockResolvedValue({ token: 'test' }),
        } as unknown as IdentityServiceClient);
        const fakeGrpcClient = {
          invoke: jest
            .fn()
            .mockRejectedValueOnce(
              new Error('Could not connect to provided IP'),
            )
            .mockResolvedValue({ foo: 'bar' }),
        };
        const logic = new Logic({
          containerManager: fakeContainerManager as unknown as ContainerManager,
          functionsRepo: fakeRepo as unknown as FunctionsRepo,
          grpcClient: fakeGrpcClient as unknown as GrpcClient,
          logger: fakeLogger as unknown as BaseLogger,
        });

        // Act
        const result = await logic.executeFunction(
          'test-id',
          JSON.stringify({ baz: 1 }),
        );

        // Assert
        expect(result).toEqual({ foo: 'bar' });
        expect(fakeGrpcClient.invoke).toHaveBeenCalledTimes(2);
      });
    });

    it('when function does not exist raises error', async () => {
      // Arrange
      const fakeRepo = {
        getFunctionInfo: jest
          .fn()
          .mockRejectedValueOnce(new Error('Func does not exist')),
      };
      const logic = new Logic({
        functionsRepo: fakeRepo as unknown as FunctionsRepo,
        logger: fakeLogger as unknown as BaseLogger,
      });

      // Act & Assert
      await expect(
        logic.executeFunction('test-id', JSON.stringify({ baz: 1 })),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"Func does not exist"`);
    });

    it('when function exists but cannot impersonate successfully raises error', async () => {
      // Arrange
      mockMdsSdk.getIdentityServiceClient.mockResolvedValueOnce({
        impersonateUser: jest
          .fn()
          .mockRejectedValueOnce(new Error('FakeIdentityError')),
      } as unknown as IdentityServiceClient);
      const fakeContainerManager = {
        readyFunctionContainerForImage: jest.fn().mockResolvedValueOnce({
          ip: 'test-ip',
          handle: 'test-handle',
        }),
        releaseFunctionContainer: jest.fn(),
      };
      const fakeRepo = {
        getFunctionInfo: jest.fn().mockResolvedValueOnce({
          fullTagName: 'test/tag',
          tagVersion: '1',
          accountId: '1001',
        }),
      };
      const logic = new Logic({
        containerManager: fakeContainerManager as unknown as ContainerManager,
        functionsRepo: fakeRepo as unknown as FunctionsRepo,
        logger: fakeLogger as unknown as BaseLogger,
      });

      // Act & Assert
      await expect(
        logic.executeFunction('test-id', JSON.stringify({ baz: 1 })),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`"FakeIdentityError"`);
    });
  });

  describe('removeFunction', () => {
    it('forwards request to repository', async () => {
      // Arrange
      const fakeRepo = {
        removeFunction: jest.fn().mockResolvedValueOnce(undefined),
      };
      const logic = new Logic({
        functionsRepo: fakeRepo as unknown as FunctionsRepo,
      });

      // Act
      await logic.removeFunction('test-id');

      // Assert
      expect(fakeRepo.removeFunction).toHaveBeenCalledTimes(1);
      expect(fakeRepo.removeFunction).toHaveBeenCalledWith('test-id');
    });
  });
});
