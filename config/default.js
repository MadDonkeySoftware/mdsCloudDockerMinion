module.exports = {
  // The port that the HTTP interface will listen upon for requests
  apiPort: 8888,

  // When true, enables the swagger interface. This should only be enabled for non-production environments.
  enableSwagger: false,

  // Connection details for the private docker repository
  registry: {
    address: '127.0.0.1:5000',
    user: 'admin',
    password: 'pwd',
  },

  // Network that function containers should be added to
  // containerNetwork: 'example',

  // MDS SDK initialization options
  mdsSdk: {
    nsUrl: 'http://127.0.0.1:8082',
    qsUrl: 'http://127.0.0.1:8083',
    fsUrl: 'http://127.0.0.1:8084',
    identityUrl: 'http://127.0.0.1:8079',
    account: '1',
    userId: 'admin',
    password: 'pwd',
  },

  // Underlying data store connection information
  mongo: {
    url: 'mongodb://127.0.0.1:27017',
    database: 'mdsCloudDockerMinion',
  },

  fastifyOptions: {
    logger: {
      level: 'info',
      mixin: (mergeObject) => ({
        ...mergeObject,
        'event.dataset': 'mdsCloudDockerMinion',
      }),
    },
  },

  // The provider element for all ORIDs created or consumed. Used in the validation process.
  oridProviderKey: 'orid',

  docker: {
    socketPath: '/var/run/docker.sock',
  },
};
