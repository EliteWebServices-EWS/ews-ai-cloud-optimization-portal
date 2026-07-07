import type { OptimizationPlugin } from '../shared/interfaces';
import type { ProviderInterface } from '../shared/interfaces';
import type { PluginMetadata } from '../shared/types';
import { PLUGIN_NAMES, type PluginName } from '../shared/constants';
import { createEc2Plugin } from './ec2';

export { Ec2Plugin, createEc2Plugin } from './ec2';

/** Registry of available optimization plugins. */
export class PluginRegistry {
  private readonly plugins = new Map<PluginName, OptimizationPlugin>();

  constructor(provider: ProviderInterface) {
    this.register(createEc2Plugin(provider));
  }

  register(plugin: OptimizationPlugin): void {
    this.plugins.set(plugin.metadata.name, plugin);
  }

  get(name: PluginName): OptimizationPlugin {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin not found: ${name}`);
    }
    return plugin;
  }

  list(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map((p) => p.metadata);
  }
}

export function createPluginRegistry(provider: ProviderInterface): PluginRegistry {
  return new PluginRegistry(provider);
}

export const SUPPORTED_PLUGINS: PluginName[] = [PLUGIN_NAMES.EC2];
