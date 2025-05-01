import Docker from 'dockerode';

export function GetDockerInterface() {
  let socketPath = '/var/run/docker.sock';

  if (process.env.MDS_CLOUD_DOCKER_SOCK) {
    socketPath = process.env.MDS_CLOUD_DOCKER_SOCK;
  }

  return new Docker({
    socketPath,
  });
}
