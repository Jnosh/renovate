import { join } from 'upath';
import { envMock, mockExecAll } from '../../../../test/exec-util';
import { env, fs, mocked } from '../../../../test/util';
import { GlobalConfig } from '../../../config/global';
import type { RepoGlobalConfig } from '../../../config/types';
import * as docker from '../../../util/exec/docker';
import * as _datasource from '../../datasource';
import type { UpdateArtifactsConfig } from '../types';
import * as _swiftUtil from './util';
import * as swift from '.';

const datasource = mocked(_datasource);
const swiftUtil = mocked(_swiftUtil);

jest.mock('../../../util/exec/env');
jest.mock('../../../util/git');
jest.mock('../../../util/http');
jest.mock('../../../util/fs');
jest.mock('../../datasource');
jest.mock('./util');

process.env.BUILDPACK = 'true';

const config: UpdateArtifactsConfig = {};

const adminConfig: RepoGlobalConfig = {
  // `join` fixes Windows CI
  localDir: join('/tmp/github/some/repo'),
  cacheDir: join('/tmp/cache'),
  containerbaseDir: join('/tmp/cache/containerbase'),
};

describe('modules/manager/swift/artifacts', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.resetModules();

    env.getChildProcessEnv.mockReturnValue(envMock.basic);
    GlobalConfig.set(adminConfig);
    docker.resetPrefetchedImages();
  });

  afterEach(() => {
    GlobalConfig.reset();
  });

  it('returns null if no Package.resolved file found', async () => {
    fs.getSiblingFileName.mockReturnValueOnce('Package.resolved');
    fs.localPathExists.mockResolvedValueOnce(false);
    const updatedDeps = [
      {
        depName: 'dep1',
      },
    ];
    expect(
      await swift.updateArtifacts({
        packageFileName: 'Package.swift',
        updatedDeps,
        newPackageFileContent: '',
        config,
      })
    ).toBeNull();
  });

  it('returns null if updatedDeps is empty', async () => {
    expect(
      await swift.updateArtifacts({
        packageFileName: 'Package.swift',
        updatedDeps: [],
        newPackageFileContent: '',
        config,
      })
    ).toBeNull();
  });

  it('returns null if unchanged', async () => {
    swiftUtil.extractSwiftToolsVersion.mockReturnValueOnce('5.0.0');
    fs.getSiblingFileName.mockReturnValueOnce('Package.resolved');
    fs.localPathExists.mockResolvedValueOnce(true);
    fs.readLocalFile.mockResolvedValueOnce('Current Package.resolved');
    fs.getParentDir.mockReturnValueOnce('');
    const execSnapshots = mockExecAll();
    fs.readLocalFile.mockResolvedValueOnce('Current Package.resolved');

    const updatedDeps = [
      {
        depName: 'dep1',
      },
    ];
    expect(
      await swift.updateArtifacts({
        packageFileName: 'Package.swift',
        updatedDeps,
        newPackageFileContent: '',
        config,
      })
    ).toBeNull();
    expect(execSnapshots).toMatchObject([
      {
        cmd: 'swift package resolve',
        options: {
          cwd: '/tmp/github/some/repo',
        },
      },
    ]);
  });

  it('returns updated Package.resolved', async () => {
    swiftUtil.extractSwiftToolsVersion.mockReturnValueOnce('5.0.0');
    fs.getSiblingFileName.mockReturnValueOnce('Package.resolved');
    fs.localPathExists.mockResolvedValueOnce(true);
    fs.readLocalFile.mockResolvedValueOnce('Old Package.resolved');
    fs.getParentDir.mockReturnValueOnce('');
    const execSnapshots = mockExecAll();
    fs.readLocalFile.mockResolvedValueOnce('New Package.resolved');
    const updatedDeps = [
      {
        depName: 'dep1',
      },
    ];
    expect(
      await swift.updateArtifacts({
        packageFileName: 'Package.swift',
        updatedDeps,
        newPackageFileContent: '{}',
        config,
      })
    ).toEqual([
      {
        file: {
          type: 'addition',
          path: 'Package.resolved',
          contents: 'New Package.resolved',
        },
      },
    ]);
    expect(execSnapshots).toMatchObject([
      {
        cmd: 'swift package resolve',
        options: {
          cwd: '/tmp/github/some/repo',
        },
      },
    ]);
  });

  it('handles package in subfolder', async () => {
    swiftUtil.extractSwiftToolsVersion.mockReturnValueOnce('5.0.0');
    fs.getSiblingFileName.mockReturnValueOnce('sub/path/Package.resolved');
    fs.localPathExists.mockResolvedValueOnce(true);
    fs.readLocalFile.mockResolvedValueOnce('Old Package.resolved');
    fs.getParentDir.mockReturnValueOnce('sub/path/');
    const execSnapshots = mockExecAll();
    fs.readLocalFile.mockResolvedValueOnce('New Package.resolved');
    const updatedDeps = [
      {
        depName: 'dep1',
      },
    ];
    expect(
      await swift.updateArtifacts({
        packageFileName: 'sub/path/Package.swift',
        updatedDeps,
        newPackageFileContent: '{}',
        config,
      })
    ).toEqual([
      {
        file: {
          type: 'addition',
          path: 'sub/path/Package.resolved',
          contents: 'New Package.resolved',
        },
      },
    ]);
    expect(execSnapshots).toMatchObject([
      {
        cmd: 'swift package resolve',
        options: {
          cwd: '/tmp/github/some/repo/sub/path',
        },
      },
    ]);
  });

  it('returns updated Package.resolved for lockfile maintenance', async () => {
    swiftUtil.extractSwiftToolsVersion.mockReturnValueOnce('5.0.0');
    fs.getSiblingFileName.mockReturnValueOnce('Package.resolved');
    fs.localPathExists.mockResolvedValueOnce(true);
    fs.readLocalFile.mockResolvedValueOnce('Old Package.resolved');
    fs.getParentDir.mockReturnValueOnce('');
    const execSnapshots = mockExecAll();
    fs.readLocalFile.mockResolvedValueOnce('New Package.resolved');
    expect(
      await swift.updateArtifacts({
        packageFileName: 'Package.swift',
        updatedDeps: [],
        newPackageFileContent: '{}',
        config: { ...config, updateType: 'lockFileMaintenance' },
      })
    ).toEqual([
      {
        file: {
          type: 'addition',
          path: 'Package.resolved',
          contents: 'New Package.resolved',
        },
      },
    ]);
    expect(execSnapshots).toMatchObject([
      {
        cmd: 'swift package resolve',
        options: {
          cwd: '/tmp/github/some/repo',
        },
      },
    ]);
  });

  it('supports install mode', async () => {
    GlobalConfig.set({ ...adminConfig, binarySource: 'install' });
    datasource.getPkgReleases.mockResolvedValueOnce({
      releases: [
        { version: '4.0.0' },
        { version: '5.0.0' },
        { version: '5.7.0' },
        { version: '5.7.2' },
      ],
    });
    swiftUtil.extractSwiftToolsVersion.mockReturnValueOnce('5.0.0');
    fs.getSiblingFileName.mockReturnValueOnce('Package.resolved');
    fs.localPathExists.mockResolvedValueOnce(true);
    fs.readLocalFile.mockResolvedValueOnce('Old Package.resolved');
    fs.getParentDir.mockReturnValueOnce('');
    const execSnapshots = mockExecAll();
    fs.readLocalFile.mockResolvedValueOnce('New Package.resolved');
    const updatedDeps = [
      {
        depName: 'dep1',
      },
    ];
    expect(
      await swift.updateArtifacts({
        packageFileName: 'Package.swift',
        updatedDeps,
        newPackageFileContent: '{}',
        config,
      })
    ).toEqual([
      {
        file: {
          type: 'addition',
          path: 'Package.resolved',
          contents: 'New Package.resolved',
        },
      },
    ]);
    expect(execSnapshots).toMatchObject([
      { cmd: 'install-tool swift 5.7.2' },
      {
        cmd: 'swift package resolve',
        options: {
          cwd: '/tmp/github/some/repo',
        },
      },
    ]);
  });

  it('supports install mode with constraints', async () => {
    GlobalConfig.set({ ...adminConfig, binarySource: 'install' });
    swiftUtil.extractSwiftToolsVersion.mockReturnValueOnce('5.0.0');
    fs.getSiblingFileName.mockReturnValueOnce('Package.resolved');
    fs.localPathExists.mockResolvedValueOnce(true);
    fs.readLocalFile.mockResolvedValueOnce('Old Package.resolved');
    fs.getParentDir.mockReturnValueOnce('');
    const execSnapshots = mockExecAll();
    fs.readLocalFile.mockResolvedValueOnce('New Package.resolved');
    const updatedDeps = [
      {
        depName: 'dep1',
      },
    ];
    expect(
      await swift.updateArtifacts({
        packageFileName: 'Package.swift',
        updatedDeps,
        newPackageFileContent: '{}',
        config: {
          ...config,
          constraints: {
            swift: '5.4.0',
          },
        },
      })
    ).toEqual([
      {
        file: {
          type: 'addition',
          path: 'Package.resolved',
          contents: 'New Package.resolved',
        },
      },
    ]);
    expect(execSnapshots).toMatchObject([
      { cmd: 'install-tool swift 5.4.0' },
      {
        cmd: 'swift package resolve',
        options: {
          cwd: '/tmp/github/some/repo',
        },
      },
    ]);
  });

  it('supports docker mode', async () => {
    GlobalConfig.set({ ...adminConfig, binarySource: 'docker' });
    datasource.getPkgReleases.mockResolvedValueOnce({
      releases: [
        { version: '4.0.0' },
        { version: '5.0.0' },
        { version: '5.7.0' },
        { version: '5.7.2' },
      ],
    });
    swiftUtil.extractSwiftToolsVersion.mockReturnValueOnce('5.0.0');
    fs.getSiblingFileName.mockReturnValueOnce('Package.resolved');
    fs.localPathExists.mockResolvedValueOnce(true);
    fs.readLocalFile.mockResolvedValueOnce('Old Package.resolved');
    fs.getParentDir.mockReturnValueOnce('');
    const execSnapshots = mockExecAll();
    fs.readLocalFile.mockResolvedValueOnce('New Package.resolved');
    const updatedDeps = [
      {
        depName: 'dep1',
      },
    ];
    expect(
      await swift.updateArtifacts({
        packageFileName: 'Package.swift',
        updatedDeps,
        newPackageFileContent: '{}',
        config,
      })
    ).toEqual([
      {
        file: {
          type: 'addition',
          path: 'Package.resolved',
          contents: 'New Package.resolved',
        },
      },
    ]);
    expect(execSnapshots).toMatchObject([
      { cmd: 'docker pull renovate/sidecar' },
      { cmd: 'docker ps --filter name=renovate_sidecar -aq' },
      {
        cmd:
          'docker run --rm --name=renovate_sidecar --label=renovate_child ' +
          '-v "/tmp/github/some/repo":"/tmp/github/some/repo" ' +
          '-v "/tmp/cache":"/tmp/cache" ' +
          '-e BUILDPACK_CACHE_DIR ' +
          '-e CONTAINERBASE_CACHE_DIR ' +
          '-w "/tmp/github/some/repo" ' +
          'renovate/sidecar' +
          ' bash -l -c "' +
          'install-tool swift 5.7.2' +
          ' && ' +
          'swift package resolve' +
          '"',
        options: {
          cwd: '/tmp/github/some/repo',
        },
      },
    ]);
  });

  it('supports docker mode with constraints', async () => {
    GlobalConfig.set({ ...adminConfig, binarySource: 'docker' });
    fs.getSiblingFileName.mockReturnValueOnce('Package.resolved');
    fs.localPathExists.mockResolvedValueOnce(true);
    fs.readLocalFile.mockResolvedValueOnce('Old Package.resolved');
    fs.getParentDir.mockReturnValueOnce('');
    const execSnapshots = mockExecAll();
    fs.readLocalFile.mockResolvedValueOnce('New Package.resolved');
    const updatedDeps = [
      {
        depName: 'dep1',
      },
    ];
    expect(
      await swift.updateArtifacts({
        packageFileName: 'Package.swift',
        updatedDeps,
        newPackageFileContent: '{}',
        config: {
          ...config,
          constraints: {
            swift: '5.4.0',
          },
        },
      })
    ).toEqual([
      {
        file: {
          type: 'addition',
          path: 'Package.resolved',
          contents: 'New Package.resolved',
        },
      },
    ]);
    expect(execSnapshots).toMatchObject([
      { cmd: 'docker pull renovate/sidecar' },
      { cmd: 'docker ps --filter name=renovate_sidecar -aq' },
      {
        cmd:
          'docker run --rm --name=renovate_sidecar --label=renovate_child ' +
          '-v "/tmp/github/some/repo":"/tmp/github/some/repo" ' +
          '-v "/tmp/cache":"/tmp/cache" ' +
          '-e BUILDPACK_CACHE_DIR ' +
          '-e CONTAINERBASE_CACHE_DIR ' +
          '-w "/tmp/github/some/repo" ' +
          'renovate/sidecar' +
          ' bash -l -c "' +
          'install-tool swift 5.4.0' +
          ' && ' +
          'swift package resolve' +
          '"',
        options: {
          cwd: '/tmp/github/some/repo',
        },
      },
    ]);
  });

  it('catches errors', async () => {
    swiftUtil.extractSwiftToolsVersion.mockReturnValueOnce('5.0.0');
    fs.getSiblingFileName.mockReturnValueOnce('Package.resolved');
    fs.localPathExists.mockResolvedValueOnce(true);
    fs.readLocalFile.mockResolvedValueOnce('Current Package.resolved');
    fs.writeLocalFile.mockImplementationOnce(() => {
      throw new Error('not found');
    });
    const updatedDeps = [
      {
        depName: 'dep1',
      },
    ];
    expect(
      await swift.updateArtifacts({
        packageFileName: 'Package.swift',
        updatedDeps,
        newPackageFileContent: '{}',
        config,
      })
    ).toEqual([
      { artifactError: { lockFile: 'Package.resolved', stderr: 'not found' } },
    ]);
  });
});
