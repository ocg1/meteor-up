import { join, resolve } from 'path';

import { addPluginValidator } from './validate';
import debug from 'debug';
import fs from 'fs';
import globalModules from 'global-modules';
import path from 'path';
import registerCommand from './commands';
import { registerHook } from './hooks';
import { registerPreparer } from './prepare-config';
import { registerScrubber } from './scrub-config';
import resolveFrom from 'resolve-from';

const log = debug('mup:plugin-loader');

const modules = {};
export default modules;

// Load all folders in ./plugins as mup plugins.
// The directory name is the module name.
let bundledPlugins = fs
  .readdirSync(resolve(__dirname, 'plugins'))
  .map(name => {
    return { name, path: `./plugins/${name}` };
  })
  .filter(isDirectoryMupModule);

loadPlugins(bundledPlugins);

export function locatePluginDir(name, configPath, appPath) {
  log(`loading plugin ${name}`);

  if (name.indexOf('.') === 0 || name.indexOf('/') === 0 || name.indexOf('~') === 0) {
    log('plugin name is a path to the plugin');
    return name;
  }

  const configLocalPath = resolveFrom.silent(configPath, name);
  if (configLocalPath) {
    log('plugin installed locally to config folder');
    return configLocalPath;
  }
  try {
    const mupLocal = require.resolve(name);
    log('plugin installed locally with mup');
    return mupLocal;
  } catch (e) {
    // Continues to next location to resolve from
  }

  const appLocalPath = resolveFrom.silent(appPath, name);
  if (appLocalPath) {
    log('plugin installed locall in app folder');
    return appLocalPath;
  }

  log(`global install path: ${globalModules}`);
  const globalPath = resolveFrom.silent(path.resolve(globalModules, '..'), name);
  if (globalPath) {
    log('plugin installed globally');
    return globalPath;
  }
  log('plugin not found');
  return name;
}

export function loadPlugins(plugins) {
  plugins
    .map(plugin => {
      try {
        let module = require(plugin.path); // eslint-disable-line global-require
        let name = module.name || plugin.name;
        return { name, module };
      } catch (e) {
        const pathPosition = e.message.length - plugin.path.length - 1;

        // Hides error when plugin cannot be loaded
        // Show the error when a plugin cannot resolve a module
        if (
          e.code !== 'MODULE_NOT_FOUND' ||
          e.message.indexOf(plugin.path) !== pathPosition
        ) {
          console.log(e);
        }

        console.log(`Unable to load plugin ${plugin.name}`);
        return { name: module.name || plugin.name, failed: true };
      }
    })
    .filter(plugin => !plugin.failed)
    .forEach(plugin => {
      modules[plugin.name] = plugin.module;
      if (plugin.module.commands) {
        Object.keys(plugin.module.commands).forEach(key => {
          registerCommand(plugin.name, key, plugin.module.commands[key]);
        });
      }
      if (plugin.module.hooks) {
        Object.keys(plugin.module.hooks).forEach(key => {
          registerHook(key, plugin.module.hooks[key]);
        });
      }
      if (typeof plugin.module.validate === 'object') {
        const validators = Object.entries(plugin.module.validate);
        for (const [property, validator] of validators) {
          addPluginValidator(property, validator);
        }
      }
      if (plugin.module.prepareConfig) {
        registerPreparer(plugin.module.prepareConfig);
      }
      if (plugin.module.scrubConfig) {
        registerScrubber(plugin.module.scrubConfig);
      }
    });
}

function isDirectoryMupModule({ name, path: modulePath }) {
  if (name === '__tests__') {
    return false;
  }

  const moduleDir = join(__dirname, modulePath);
  return fs.statSync(moduleDir).isDirectory();
}
