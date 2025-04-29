import { ContainerManager } from '../../core/container-manager';
import { buildApp } from '../index';

jest.mock('../../core/container-manager');
const mockContainerManager = jest.mocked(ContainerManager);

describe('presentation', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe('buildApp', () => {
    it('using default DI creates and does not start container manager', () => {
      // Act
      expect(() => buildApp()).not.toThrow();

      // Assert
      expect(mockContainerManager.prototype.startMonitor).toHaveBeenCalledTimes(
        0,
      );
    });
  });
});
