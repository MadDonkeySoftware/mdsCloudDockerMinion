import {
  CreateContainerOptions,
  DockerRepo,
} from '../../core/interfaces/docker-repo';
import Docker, {
  ContainerInfo,
  ContainerInspectInfo,
  ImageBuildOptions,
  ImagePushOptions,
} from 'dockerode';
import config from 'config';

export class DockerRepoImpl implements DockerRepo {
  docker: Docker;

  constructor(docker?: Docker) {
    if (docker) {
      this.docker = docker;
    } else {
      let socketPath = '/var/run/docker.sock';

      if (process.env.MDS_CLOUD_DOCKER_SOCK) {
        socketPath = process.env.MDS_CLOUD_DOCKER_SOCK;
      } else if (config.has('docker.socketPath')) {
        socketPath = config.get('docker.socketPath');
      }

      this.docker = new Docker({
        socketPath,
      });
    }
  }

  async buildImage(
    file: string | NodeJS.ReadableStream,
    options: ImageBuildOptions,
  ): Promise<void> {
    const buildStream = await this.docker.buildImage(file, options);

    return new Promise((resolve, reject) => {
      this.docker.modem.followProgress(buildStream, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async pushImage(
    fullTagName: string,
    version: string | number,
  ): Promise<void> {
    const image = this.docker.getImage(`${fullTagName}:${version}`);
    const options: ImagePushOptions = {
      authconfig: {
        username: config.get('registry.user'),
        password: config.get('registry.password'),
        serveraddress: config.get('registry.address'),
      },
    };
    const stream = await image.push(options);

    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async removeLocalImage(
    fullTagName: string,
    version: string | number,
  ): Promise<void> {
    const image = this.docker.getImage(`${fullTagName}:${version}`);
    await image.remove();
  }

  async createContainer(options: CreateContainerOptions): Promise<string> {
    const container = await this.docker.createContainer({
      Image: options.image,
      name: options.name,
      HostConfig: {
        NetworkMode: options.networkMode ?? 'bridge',
      },
    });
    return container.id;
  }

  async getContainerInfo(id: string): Promise<ContainerInspectInfo> {
    const container = await this.docker.getContainer(id);
    return container.inspect();
  }

  listContainers(onlyRunning = false): Promise<ContainerInfo[]> {
    return this.docker.listContainers({ all: !onlyRunning });
  }

  async removeContainer(id: string): Promise<void> {
    // TODO: do nothing if the container doesn't exist
    const container = await this.docker.getContainer(id);
    await container.remove();
  }

  async startContainer(id: string): Promise<void> {
    try {
      const container = await this.docker.getContainer(id);
      await container.start();
    } catch (err) {
      if ((err as Error).message.indexOf('container already started') > -1) {
        return;
      }
      throw err;
    }
  }

  async stopContainer(id: string): Promise<void> {
    try {
      const container = await this.docker.getContainer(id);
      await container.stop();
    } catch (err) {
      if ((err as Error).message.indexOf('container already stopped') > -1) {
        return;
      }
      throw err;
    }
  }
}
