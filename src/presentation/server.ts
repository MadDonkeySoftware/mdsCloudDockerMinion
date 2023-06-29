import config from 'config';
import { buildApp } from './index';
import { initialize } from './logging';
import { MdsSdk } from '@maddonkeysoftware/mds-cloud-sdk-node';

// skipcq: JS-0098
void (async () => {
  const port = config.get<number>('apiPort');
  const app = await buildApp();

  initialize(app.log);

  try {
    const address = await app.listen({ port, host: '::' });

    app.log.info(
      app.printRoutes({
        includeHooks: false,
        includeMeta: ['metaProperty'],
      }),
    );

    const sdkInitTask = MdsSdk.initialize({
      nsUrl: config.get<string | undefined>('mdsSdk.nsUrl'),
      qsUrl: config.get<string | undefined>('mdsSdk.qsUrl'),
      fsUrl: config.get<string | undefined>('mdsSdk.fsUrl'),
      identityUrl: config.get<string | undefined>('mdsSdk.identityUrl'),
      account: config.get<string | undefined>('mdsSdk.account'),
      userId: config.get<string | undefined>('mdsSdk.userId'),
      password: config.get<string | undefined>('mdsSdk.password'),
    });
    app.log.info(`Server listening at ${address}`);

    await Promise.all([sdkInitTask]);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
