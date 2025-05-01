import Docker from 'dockerode';
import config from "config";

export function GetDockerInterface() {
  let socketPath = '/var/run/docker.sock';

  if (process.env.MDS_CLOUD_DOCKER_SOCK) {
    socketPath = process.env.MDS_CLOUD_DOCKER_SOCK;
  } else if (config.has('docker.socketPath')) {
    socketPath = config.get('docker.socketPath');
  }

  return new Docker({
    socketPath,
  });
}
