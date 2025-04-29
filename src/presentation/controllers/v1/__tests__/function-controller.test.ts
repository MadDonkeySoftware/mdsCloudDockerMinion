import { asFunction, Lifetime } from 'awilix';
import { FastifyInstance, InjectOptions } from 'fastify';
import FormData from 'form-data';
import * as src from '../../..';
import { createReadStream } from 'fs';
import { join } from 'path';

jest.mock('../../../hooks/validate-token', () => {
  return {
    ValidateToken: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('../../../hooks/ensure-request-from-system', () => {
  return {
    EnsureRequestFromSystem: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('stream/promises', () => ({
  pipeline: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('shelljs', () => ({
  exec: jest.fn(),
}));

describe('functionController test', () => {
  let app: FastifyInstance;
  const logicMock = {
    createFunction: jest.fn(),
    listFunctions: jest.fn(),
    buildFunction: jest.fn(),
    executeFunction: jest.fn(),
    removeFunction: jest.fn(),
  };

  function makeRequest(overrides: InjectOptions = {}) {
    return app.inject({
      ...({
        url: '/',
        method: 'GET',
      } as InjectOptions),
      ...overrides,
    });
  }

  beforeAll(async () => {
    app = await src.buildApp(({ diContainer }) => {
      diContainer.register({
        logic: asFunction(() => logicMock, {
          lifetime: Lifetime.SCOPED,
        }),
      });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe('createFunction', () => {
    it('when valid request, responds with 202 and created details', async () => {
      // Arrange
      logicMock.createFunction.mockResolvedValue({
        exists: false,
        id: 'newTestId',
      });

      // Act
      const response = await makeRequest({
        url: '/v1/createFunction',
        method: 'POST',
        headers: {
          token: 'testToken',
        },
        payload: {
          name: 'testName',
          accountId: 'testAccountId',
        },
      });

      // Assert
      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        name: 'testName',
        id: 'newTestId',
      });
      expect(logicMock.createFunction).toHaveBeenCalledWith({
        accountId: 'testAccountId',
        name: 'testName',
      });
    });

    it('when function exists for account, returns 409', async () => {
      logicMock.createFunction.mockResolvedValue({
        exists: true,
      });

      // Act
      const response = await makeRequest({
        url: '/v1/createFunction',
        method: 'POST',
        headers: {
          token: 'testToken',
        },
        payload: {
          name: 'testName',
          accountId: 'testAccountId',
        },
      });

      // Assert
      expect(response.statusCode).toBe(409);
      expect(logicMock.createFunction).toHaveBeenCalledWith({
        accountId: 'testAccountId',
        name: 'testName',
      });
    });

    it('when invalid body, returns 400', async () => {
      logicMock.createFunction.mockResolvedValue({
        exists: true,
      });

      // Act
      const response = await makeRequest({
        url: '/v1/createFunction',
        method: 'POST',
        headers: {
          token: 'testToken',
        },
        payload: {},
      });

      // Assert
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Bad Request',
        message: "body must have required property 'name'",
        statusCode: 400,
      });
      expect(logicMock.createFunction).toHaveBeenCalledTimes(0);
    });

    it('when unhandled error is thrown, 500 returned with reference number', async () => {
      logicMock.createFunction.mockRejectedValue(new Error('test error'));

      // Act
      const response = await makeRequest({
        url: '/v1/createFunction',
        method: 'POST',
        headers: {
          token: 'testToken',
        },
        payload: {
          name: 'testName',
          accountId: 'testAccountId',
        },
      });

      // Assert
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual(
        expect.objectContaining({
          referenceNumber: expect.any(String),
          status: 'Failed',
        }),
      );
      expect(logicMock.createFunction).toHaveBeenCalledWith({
        accountId: 'testAccountId',
        name: 'testName',
      });
    });
  });

  describe('listFunctions', () => {
    it('when valid request, responds with 200 and details', async () => {
      // Arrange
      const data = [
        {
          id: 'func1',
          name: 'Function 1',
          accountId: '1001',
          created: new Date().toISOString(),
          maxProcesses: 1,
          nextVersion: 1,
        },
        {
          id: 'func2',
          name: 'Function 2',
          accountId: '1001',
          created: new Date().toISOString(),
          maxProcesses: 1,
          nextVersion: 1,
        },
      ];
      logicMock.listFunctions.mockResolvedValue(data);

      // Act
      const response = await makeRequest({
        url: '/v1/all',
        method: 'GET',
        headers: {
          token: 'testToken',
        },
      });

      // Assert
      expect(JSON.parse(response.body)).toEqual(data);
      expect(response.statusCode).toBe(200);
    });

    it('when unhandled error is thrown, responds with 500 and reference number', async () => {
      // Arrange
      logicMock.listFunctions.mockRejectedValue(new Error('test error'));

      // Act
      const response = await makeRequest({
        url: '/v1/all',
        method: 'GET',
        headers: {
          token: 'testToken',
        },
      });

      // Assert
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual(
        expect.objectContaining({
          referenceNumber: expect.any(String),
          status: 'Failed',
        }),
      );
    });
  });

  describe('buildFunction', () => {
    it('when valid request, responds with 200 and status', async () => {
      // Arrange
      logicMock.buildFunction.mockResolvedValue({});
      const payload = new FormData();
      payload.append('runtime', 'node');
      payload.append('entryPoint', '/foo/bar:baz');
      payload.append('functionId', 'testFunctionId');
      payload.append(
        'sourceArchive',
        createReadStream(
          join(__dirname, 'data', 'mdsCloudServerlessFunctions-sampleApp.zip'),
        ),
      );

      // Act
      const response = await makeRequest({
        url: '/v1/buildFunction',
        method: 'POST',
        headers: {
          ...payload.getHeaders(),
          token: 'testToken',
        },
        payload,
      });

      // Assert
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(
        expect.objectContaining({
          status: 'success',
        }),
      );
      expect(logicMock.buildFunction).toHaveBeenCalledWith({
        context: undefined,
        entryPoint: '/foo/bar:baz',
        functionId: 'testFunctionId',
        runtime: 'node',
        localFilePath: expect.stringMatching(
          /\/tmp\/.{8}-mdsCloudServerlessFunctions-sampleApp\.zip/,
        ),
      });
    });

    it('when file missing from request, responds with 400 and status', async () => {
      // Arrange
      logicMock.buildFunction.mockResolvedValue({});
      const payload = new FormData();
      payload.append('runtime', 'node');
      payload.append('entryPoint', '/foo/bar:baz');
      payload.append('functionId', 'testFunctionId');

      // Act
      const response = await makeRequest({
        url: '/v1/buildFunction',
        method: 'POST',
        headers: {
          ...payload.getHeaders(),
          token: 'testToken',
        },
        payload,
      });

      // Assert
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual([
        {
          message: 'sourceArchive missing from payload',
        },
      ]);
      expect(logicMock.buildFunction).toHaveBeenCalledTimes(0);
    });

    it('when invalid body, responds with 400 and status', async () => {
      // Arrange
      logicMock.buildFunction.mockResolvedValue({});
      const payload = new FormData();
      payload.append(
        'sourceArchive',
        createReadStream(
          join(__dirname, 'data', 'mdsCloudServerlessFunctions-sampleApp.zip'),
        ),
      );

      // Act
      const response = await makeRequest({
        url: '/v1/buildFunction',
        method: 'POST',
        headers: {
          ...payload.getHeaders(),
          token: 'testToken',
        },
        payload,
      });

      // Assert
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual([
        {
          message: 'functionId missing from payload',
        },
        {
          message: 'runtime missing from payload',
        },
        {
          message: 'entryPoint missing from payload',
        },
      ]);
      expect(logicMock.buildFunction).toHaveBeenCalledTimes(0);
    });

    it('when unhandled error is thrown, 400 returned with reference number', async () => {
      // Arrange
      logicMock.buildFunction.mockRejectedValue(new Error('test error'));
      const payload = new FormData();
      payload.append('runtime', 'node');
      payload.append('entryPoint', '/foo/bar:baz');
      payload.append('functionId', 'testFunctionId');
      payload.append(
        'sourceArchive',
        createReadStream(
          join(__dirname, 'data', 'mdsCloudServerlessFunctions-sampleApp.zip'),
        ),
      );

      // Act
      const response = await makeRequest({
        url: '/v1/buildFunction',
        method: 'POST',
        headers: {
          ...payload.getHeaders(),
          token: 'testToken',
        },
        payload,
      });

      // Assert
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        referenceNumber: expect.any(String),
        status: 'Failed',
      });
      expect(logicMock.buildFunction).toHaveBeenCalledWith({
        context: undefined,
        entryPoint: '/foo/bar:baz',
        functionId: 'testFunctionId',
        runtime: 'node',
        localFilePath: expect.stringMatching(
          /\/tmp\/.{8}-mdsCloudServerlessFunctions-sampleApp\.zip/,
        ),
      });
    });
  });

  describe('executeFunction', () => {
    it('when valid request, responds with 200 and function output', async () => {
      // Arrange
      logicMock.executeFunction.mockResolvedValue({
        sample: 'response',
      });

      // Act
      const response = await makeRequest({
        url: '/v1/executeFunction/abc123',
        method: 'POST',
        headers: {
          token: 'testToken',
        },
        payload: {
          testBody: 'input',
        },
      });

      // Assert
      expect(JSON.parse(response.body)).toEqual({
        sample: 'response',
      });
      expect(response.statusCode).toBe(200);
      expect(logicMock.executeFunction).toHaveBeenCalledWith('abc123', {
        testBody: 'input',
      });
    });

    it('when function does not exist, responds with 404', async () => {
      // Arrange
      logicMock.executeFunction.mockRejectedValue(
        new Error('function not found'),
      );

      // Act
      const response = await makeRequest({
        url: '/v1/executeFunction/abc123',
        method: 'POST',
        headers: {
          token: 'testToken',
        },
        payload: {
          testBody: 'input',
        },
      });

      // Assert
      expect(response.statusCode).toBe(404);
      expect(logicMock.executeFunction).toHaveBeenCalledWith('abc123', {
        testBody: 'input',
      });
    });

    it('when function errors, responds with 500', async () => {
      // Arrange
      logicMock.executeFunction.mockRejectedValue(new Error('test error'));

      // Act
      const response = await makeRequest({
        url: '/v1/executeFunction/abc123',
        method: 'POST',
        headers: {
          token: 'testToken',
        },
        payload: {
          testBody: 'input',
        },
      });

      // Assert
      expect(response.statusCode).toBe(500);
      expect(logicMock.executeFunction).toHaveBeenCalledWith('abc123', {
        testBody: 'input',
      });
    });
  });

  describe('removeFunction', () => {
    it('when valid request, responds with 200', async () => {
      // Arrange
      logicMock.removeFunction.mockResolvedValue(undefined);

      // Act
      const response = await makeRequest({
        url: '/v1/abc123',
        method: 'DELETE',
        headers: {
          token: 'testToken',
        },
      });

      // Assert
      expect(response.statusCode).toBe(200);
      expect(logicMock.removeFunction).toHaveBeenCalledWith('abc123');
    });

    it('when function does not exist, responds with 404', async () => {
      // Arrange
      logicMock.removeFunction.mockRejectedValue(
        new Error('function not found'),
      );

      // Act
      const response = await makeRequest({
        url: '/v1/abc123',
        method: 'DELETE',
        headers: {
          token: 'testToken',
        },
      });

      // Assert
      expect(response.statusCode).toBe(404);
      expect(logicMock.removeFunction).toHaveBeenCalledWith('abc123');
    });

    it('when function errors, responds with 500', async () => {
      // Arrange
      logicMock.removeFunction.mockRejectedValue(new Error('test error'));

      // Act
      const response = await makeRequest({
        url: '/v1/abc123',
        method: 'DELETE',
        headers: {
          token: 'testToken',
        },
      });

      // Assert
      expect(response.statusCode).toBe(500);
      expect(logicMock.removeFunction).toHaveBeenCalledWith('abc123');
    });
  });
});
