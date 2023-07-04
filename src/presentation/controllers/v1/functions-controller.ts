import { FastifyInstance } from 'fastify';
import {
  BuildFunctionRequestBody,
  BuildFunctionRequestBodySchema,
  CreateFunctionRequestBody,
  CreateFunctionRequestBodySchema,
  CreateFunctionResponseBodySchema,
  DeleteFunctionRequestParams,
  DeleteFunctionRequestParamsSchema,
  ExecuteFunctionRequestBody,
  ExecuteFunctionRequestBodySchema,
  ExecuteFunctionRequestParams,
  ExecuteFunctionRequestParamsSchema,
  ExecuteFunctionResponseBodySchema,
} from '../../schemas/function';
import { generateRandomString } from '../../../utils';
import { DateTime } from 'luxon';
import { Logic } from '../../../core/logic';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { exec } from 'shelljs';
import { MultipartValue, Multipart } from '@fastify/multipart';
import { getLogger } from '../../logging';
import { ValidateToken } from '../../hooks/validate-token';
import { EnsureRequestFromSystem } from '../../hooks/ensure-request-from-system';

export function functionsController(app: FastifyInstance) {
  app.addHook('onRequest', ValidateToken);
  app.addHook('onRequest', EnsureRequestFromSystem);

  app.post<{
    Body: CreateFunctionRequestBody;
  }>(
    '/createFunction',
    {
      schema: {
        body: CreateFunctionRequestBodySchema,
        response: {
          201: CreateFunctionResponseBodySchema,
        },
      },
    },
    async (request, response) => {
      try {
        const logic = request.diScope.resolve<Logic>('logic');
        const createResult = await logic.createFunction({
          name: request.body.name,
          accountId: request.body.accountId,
        });

        if (createResult.exists) {
          response.status(409);
          response.send();
          return;
        }

        response.status(201);
        response.send({
          name: request.body.name,
          id: createResult.id,
        });
      } catch (err) {
        const referenceNumber = `${generateRandomString(
          32,
        )}-${DateTime.utc().toMillis()}`;
        const msg = {
          status: 'Failed',
          referenceNumber,
        };
        app.log.warn({ err, referenceNumber }, 'Function failed to create');
        response.status(500);
        response.send(msg);
        return;
      }
    },
  );

  app.get(
    '/all',
    {
      schema: {
        response: {
          // TODO: Implement
          // 200: CreateFunctionResponseBodySchema,
        },
      },
    },
    async (request, response) => {
      try {
        const logic = request.diScope.resolve<Logic>('logic');
        const functions = await logic.listFunctions();

        response.status(200);
        response.send(functions);
      } catch (err) {
        const referenceNumber = `${generateRandomString(
          32,
        )}-${DateTime.utc().toMillis()}`;
        const msg = {
          status: 'Failed',
          referenceNumber,
        };
        app.log.warn(
          { err, referenceNumber },
          'Error occurred while attempting to list functions',
        );
        response.status(500);
        response.send(msg);
        return;
      }
    },
  );

  app.post<{
    Body: BuildFunctionRequestBody;
  }>(
    '/buildFunction',
    {
      schema: {
        // body: BuildFunctionRequestBodySchema, // NOTE: Cannot do body validation here due to file upload stuff
        response: {
          201: BuildFunctionRequestBodySchema,
        },
      },
    },
    async (request, response) => {
      const file = await request.file();
      if (!file) {
        response.status(400);
        response.send([
          {
            message: 'sourceArchive missing from payload',
          },
        ]);
        return;
      }

      const getFormField = (
        field: Multipart | Multipart[] | undefined,
      ): undefined | string => {
        if (!field) return undefined;
        return (field as MultipartValue<string>).value;
      };
      const [functionId, runtime, entryPoint, context] = [
        getFormField(file.fields.functionId),
        getFormField(file.fields.runtime),
        getFormField(file.fields.entryPoint),
        getFormField(file.fields.context),
      ];

      // validate function id, entry point, etc.
      const validationFailures = [];
      if (!functionId) {
        validationFailures.push({ message: 'functionId missing from payload' });
      }
      if (!runtime) {
        validationFailures.push({ message: 'runtime missing from payload' });
      }
      if (!entryPoint) {
        validationFailures.push({ message: 'entryPoint missing from payload' });
      }

      if (validationFailures.length > 0) {
        response.status(400);
        response.send(validationFailures);
        return;
      }

      let localFilePath: string | undefined;
      try {
        const distinctFile = `${generateRandomString(8)}-${file.filename}`;
        localFilePath = join(tmpdir(), distinctFile);

        // upload and save the file
        await pipeline(file.file, createWriteStream(localFilePath));

        // TODO: Figure out what metadata to move to DB from request body
        const logic = request.diScope.resolve<Logic>('logic');
        await logic.buildFunction({
          functionId: functionId as string,
          localFilePath,
          runtime: runtime as string,
          entryPoint: entryPoint as string,
          context,
        });

        response.status(200);
        response.send({
          status: 'success',
        });
      } catch (err) {
        const referenceNumber = `${generateRandomString(
          32,
        )}-${DateTime.utc().toMillis()}`;
        const msg = {
          status: 'Failed',
          referenceNumber,
        };
        app.log.warn({ err, referenceNumber }, 'Function failed to build');
        response.status(400);
        response.send(msg);
        return;
      } finally {
        if (localFilePath) {
          exec(`rm -rf ${localFilePath}`);
        }
      }
    },
  );

  app.post<{
    Body: ExecuteFunctionRequestBody;
    Params: ExecuteFunctionRequestParams;
  }>(
    '/executeFunction/:functionId',
    {
      schema: {
        body: ExecuteFunctionRequestBodySchema,
        params: ExecuteFunctionRequestParamsSchema,
        response: {
          201: ExecuteFunctionResponseBodySchema,
        },
      },
    },
    async (request, response) => {
      try {
        const logic = request.diScope.resolve<Logic>('logic');
        const result = await logic.executeFunction(
          request.params.functionId,
          request.body as string,
        );
        response.status(200);
        response.send(result);
      } catch (err) {
        if ((err as Error).message === 'function not found') {
          response.status(404);
          response.send();
          return;
        }

        const referenceNumber = `${generateRandomString(
          32,
        )}-${DateTime.utc().toMillis()}`;
        const msg = {
          status: 'Failed',
          referenceNumber,
        };
        app.log.warn(
          { err, referenceNumber },
          'Error occurred while attempting to execute function',
        );
        response.status(500);
        response.send(msg);
        return;
      }
    },
  );

  app.delete<{
    Params: DeleteFunctionRequestParams;
  }>(
    '/:functionId',
    {
      schema: {
        params: DeleteFunctionRequestParamsSchema,
      },
    },
    async (request, response) => {
      const logger = getLogger();
      try {
        const logic = request.diScope.resolve<Logic>('logic');
        await logic.removeFunction(request.params.functionId);
        response.status(200);
        response.send();
      } catch (err) {
        logger.trace('error response returned');
        if ((err as Error).message === 'function not found') {
          response.status(404);
          response.send();
          return;
        }

        logger.error(
          { err },
          'Error occurred while attempting to remove function',
        );
        response.status(500);
        response.send();
        return;
      }
    },
  );

  return Promise.resolve();
}
