import type { CloudResourceDiscoveryPlugin } from '../plugins/cloud-resource-discovery-plugin';

export class CloudDiscoveryPluginRegistry {
  private readonly plugins = new Map<string, CloudResourceDiscoveryPlugin>();

  register(plugin: CloudResourceDiscoveryPlugin): void {
    if (this.plugins.has(plugin.service)) {
      throw new Error(`Cloud discovery plugin already registered: ${plugin.service}`);
    }
    this.plugins.set(plugin.service, plugin);
  }

  get(service: string): CloudResourceDiscoveryPlugin {
    const plugin = this.plugins.get(service);
    if (!plugin) {
      throw new Error(`Unsupported cloud discovery service: ${service}`);
    }
    return plugin;
  }
}

export function createCloudDiscoveryPluginRegistry(
  plugins: CloudResourceDiscoveryPlugin[],
): CloudDiscoveryPluginRegistry {
  const registry = new CloudDiscoveryPluginRegistry();
  for (const plugin of plugins) {
    registry.register(plugin);
  }
  return registry;
}
