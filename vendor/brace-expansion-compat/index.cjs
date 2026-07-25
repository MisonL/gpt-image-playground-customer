'use strict';

const modern = require('brace-expansion-modern');
const expand = modern.expand;

module.exports = expand;
module.exports.expand = expand;
module.exports.EXPANSION_MAX = modern.EXPANSION_MAX;
module.exports.EXPANSION_MAX_LENGTH = modern.EXPANSION_MAX_LENGTH;
