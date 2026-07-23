const nodeGypPath = process.env.npm_config_node_gyp;

// Keep npm from parsing this node-gyp-only option as an unsupported config.
if (nodeGypPath && process.argv[1] === nodeGypPath) {
    process.env.npm_config_nodedir = '/usr/local';
}
