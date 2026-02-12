import config from 'config';
import { SimpleThrottle } from './simple-throttle';
import { generateRandomString } from '../utils';
import { get, max } from 'lodash';
import { DateTime } from 'luxon';
import { getLogger } from '../presentation/logging';
import { DockerRepoImpl } from '../infrastructure/repos/docker-repo-impl';
import { DockerRepo } from './interfaces/docker-repo';

export type FindContainerOptions = {
  onlyRunning?: boolean;
};

type ContainerMetadata = {
  openCalls: number;
  lastCall: DateTime;
  image: string;
  ip: string;
};

type ContainerMetadataMap = {
  [key: string]: ContainerMetadata;
};

export type ReadyFunctionContainerForImageResult = {
  handle: string;
  ip: string;
};

const MAX_STOPPED_CONTAINER_SECONDS = 60;
const MAX_RUNNING_CONTAINER_SECONDS = 15;

export class ContainerManager {
  monitorHandle: NodeJS.Timer | undefined;
  containerMetadata: ContainerMetadataMap = {};
  throttle: SimpleThrottle;
  docker: DockerRepo;
  config: config.IConfig;

  constructor({
    throttle,
    dockerRepo,
    conf,
  }: {
    throttle?: SimpleThrottle;
    dockerRepo?: DockerRepo;
    conf?: config.IConfig;
  } = {}) {
    this.throttle = throttle ?? new SimpleThrottle();
    this.docker = dockerRepo ?? new DockerRepoImpl();
    this.config = conf ?? config;
  }

  safeConfigGet(key: string, defaultValue: string): string {
    return this.config.has(key) ? this.config.get<string>(key) : defaultValue;
  }

  async findContainersMatchingImage(
    imageNameFragment: string,
    options?: FindContainerOptions,
  ) {
    const containers = await this.docker.listContainers(
      options?.onlyRunning ?? false,
    );
    return containers.filter(
      (el) => el.Image.indexOf(imageNameFragment) !== -1,
    );
  }

  startMonitor() {
    if (!this.monitorHandle) {
      const interval = 15; // Seconds
      this.monitorHandle = setInterval(async () => {
        await this.handleOrphanedContainers();
      }, interval * 1000);
    }
  }

  stopMonitor() {
    if (this.monitorHandle) {
      clearInterval(this.monitorHandle);
      this.monitorHandle = undefined;
    }
  }

  async handleOrphanedContainers() {
    const filtered = await this.findContainersMatchingImage('mds-sf-');
    const promises = filtered.map(async (info) => {
      const inspectInfo = await this.docker.getContainerInfo(info.Id);

      // Remove dead orphaned containers
      if (
        !(
          inspectInfo.State.Running ||
          inspectInfo.State.Paused ||
          inspectInfo.State.Restarting ||
          inspectInfo.State.OOMKilled ||
          inspectInfo.State.Dead
        )
      ) {
        const stoppedAt = DateTime.fromISO(inspectInfo.State.FinishedAt);
        const diff = stoppedAt.diffNow('seconds');
        if (Math.abs(diff.seconds) > MAX_STOPPED_CONTAINER_SECONDS) {
          await this.docker.removeContainer(info.Id);

          // skipcq: JS-0320
          delete this.containerMetadata[info.Id];
        }
      }

      // Remove orphaned or runtime exceeded containers
      if (inspectInfo.State.Running) {
        const meta = this.containerMetadata[info.Id];
        const lastCall = get(
          meta,
          ['lastCall'],
          DateTime.fromISO(inspectInfo.State.StartedAt),
        );
        const diff = lastCall.diffNow('seconds');
        if (Math.abs(diff.seconds) > MAX_RUNNING_CONTAINER_SECONDS) {
          await this.docker.stopContainer(info.Id);
        }
      }
    });
    await Promise.all(promises);
  }

  async electExistingContainerToReadyForImage(
    fullImageName: string,
  ): Promise<string | undefined> {
    const logger = getLogger();
    const existingContainers =
      await this.findContainersMatchingImage(fullImageName);
    const runningContainers = existingContainers.filter(
      (e) => e.State.toUpperCase() === 'RUNNING',
    );
    const exitedContainers = existingContainers.filter(
      (e) => e.State.toUpperCase() === 'EXITED',
    );

    const getRandomInt = (max: number, min = 0) =>
      Math.floor(Math.random() * Math.floor(max - min)) + min;

    let containerId: string | undefined;
    if (runningContainers.length > 0) {
      const random = getRandomInt(runningContainers.length);
      const elect = runningContainers[random];
      containerId = elect.Id;
      logger.trace(
        {
          fullImageName,
          id: elect.Id,
        },
        'Existing running container found.',
      );
    } else if (exitedContainers.length > 0) {
      const promises = exitedContainers.map((c) =>
        this.docker.getContainerInfo(c.Id),
      );
      const details = await Promise.all(promises);
      details.sort(
        (a, b) =>
          DateTime.fromISO(b.State.FinishedAt).toMillis() -
          DateTime.fromISO(a.State.FinishedAt).toMillis(),
      );
      const elect = details[0];

      // Give a slight buffer on re-using a stopped container
      const stoppedAt = DateTime.fromISO(elect.State.FinishedAt);
      const diff = stoppedAt.diffNow('seconds');
      if (Math.abs(diff.seconds) < MAX_STOPPED_CONTAINER_SECONDS - 5) {
        containerId = elect.Id;
        await this.docker.startContainer(containerId);
        logger.trace(
          {
            fullImageName,
          },
          'Existing stopped container found and restarted.',
        );
      }
    }

    return containerId;
  }

  // TODO: Add max retries to prevent infinite loop
  async readyFunctionContainerForImage(
    fullTagName: string,
    tagVersion: string,
  ): Promise<ReadyFunctionContainerForImageResult> {
    const logger = getLogger();
    const fullImageName = `${fullTagName}:${tagVersion}`;

    await this.throttle.acquire(fullImageName);
    let returnData: undefined | ReadyFunctionContainerForImageResult;
    try {
      let containerId =
        await this.electExistingContainerToReadyForImage(fullImageName);
      if (!containerId) {
        containerId = await this.docker.createContainer({
          image: `${fullTagName}:${tagVersion}`,
          name: `mds-sf-${generateRandomString(24)}`,
          networkMode: this.safeConfigGet('containerNetwork', 'bridge'),
        });

        await this.docker.startContainer(containerId);
        logger.trace(
          {
            fullImageName,
          },
          'No container found. New container started.',
        );
      }

      const customNetwork = this.safeConfigGet('containerNetwork', '');
      const inspectResult = await this.docker.getContainerInfo(containerId);
      const ip =
        customNetwork === ''
          ? inspectResult.NetworkSettings.IPAddress
          : inspectResult.NetworkSettings.Networks[customNetwork].IPAddress;
      logger.trace(
        {
          fullImageName,
          ip,
        },
        'Discovering IP for container',
      );

      if (ip) {
        const extendedMeta: ContainerMetadata = get(
          this.containerMetadata,
          [containerId],
          {},
        ) as ContainerMetadata;
        extendedMeta.openCalls = get(extendedMeta, ['openCalls'], 0) + 1;
        extendedMeta.lastCall = DateTime.now();
        extendedMeta.image = fullImageName;
        extendedMeta.ip = ip;
        this.containerMetadata[containerId] = extendedMeta;
        returnData = {
          handle: containerId,
          ip,
        };
        logger.trace(
          {
            fullImageName,
            extendedMeta,
          },
          'Metadata for IP found',
        );
      }
    } catch (err) {
      logger.error(
        { fullTagName, tagVersion, err },
        'A problem occurred while trying to ready the container for image',
      );
    } finally {
      await this.throttle.release(fullImageName);
    }
    return returnData
      ? returnData
      : this.readyFunctionContainerForImage(fullTagName, tagVersion);
  }

  releaseFunctionContainer(handle: string) {
    const newVal = get(this.containerMetadata, [handle, 'openCalls'], 1) - 1;
    this.containerMetadata[handle].openCalls = max([newVal, 0]) as number;
  }
}
