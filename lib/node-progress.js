/*!
 * node-progress
 * Copyright(c) 2011 TJ Holowaychuk <tj@vision-media.ca>
 * MIT Licensed
 */

var util = require('util');

/**
 * Expose `ProgressBar`.
 */

exports = module.exports = ProgressBar;

/**
 * Initialize a `ProgressBar` with the given `fmt` string and `options` or
 * `total`.
 *
 * Options:
 *
 *   - `total` total number of ticks to complete
 *   - `width` the displayed width of the progress bar defaulting to total
 *   - `stream` the output stream defaulting to stderr
 *   - `complete` completion character defaulting to "="
 *   - `incomplete` incomplete character defaulting to "-"
 *   - `renderThrottle` minimum time between updates in milliseconds defaulting to 16
 *   - `callback` optional function to call when the progress bar completes
 *   - `clear` will clear the progress bar upon termination
 *
 * Tokens:
 *
 *   - `:bar` the progress bar itself
 *   - `:current` current tick number
 *   - `:total` total ticks
 *   - `:elapsed` time elapsed in seconds
 *   - `:percent` completion percentage
 *   - `:eta` eta in seconds
 *
 * @param {string} fmt
 * @param {object|number} options or total
 * @api public
 */

function ProgressBar(fmt, options) {
  this.stream = options.stream || process.stderr;
  
  if (!this.stream) throw new Error('invalid stream');
  
  
  if (typeof(options) == 'number') {
    var total = options;
    options = {};
    options.total = total;
  } else {
    options = options || {};
    if ('string' != typeof fmt) throw new Error('format required');
    if ('number' != typeof options.total) throw new Error('total required');
  }

  this.fmt = fmt;
  this.curr = 0;
  this.total = options.total;
  this.units = ProgressBar.mkUnits(options.units || { 's': 1 });
  this.width = options.width || this.total;
  this.clear = options.clear
  this.chars = {
    complete   : options.complete || '=',
    incomplete : options.incomplete || '-'
  };
  this.renderThrottle = options.renderThrottle !== 0 ? (options.renderThrottle || 16) : 0;
  this.callback = options.callback || function () {};
  this.tokens = {};
  this.lastDraw = '';
}

/**
 * The default unit bindings for enhanced ETA
 */
ProgressBar.defaultUnits = {
  'h': 3600,
  'm': 60,
  's': 1
};

/**
 * Converts object mappings into something more useful for calculating ETA with
 *
 * @param {object} obj Map of suffixes to unit values
 */
ProgressBar.mkUnits = function (obj) {
  var arr = Object.keys(obj)
    .map(function (key) {
      return { label: key, value: obj[key] };
    })
    .sort(function (a, b) {
      return a.value - b.value;
    });
    
  var values = arr.map(function (unit) { return unit.value; }),
    labels = arr.map(function (unit) { return unit.label; });
  
  return { labels: labels, values: values };
};

/**
 * "tick" the progress bar with optional `len` and optional `tokens`.
 *
 * @param {number|object} len or tokens
 * @param {object} tokens
 * @api public
 */

ProgressBar.prototype.tick = function(len, tokens){
  if (len !== 0)
    len = len || 1;

  // swap tokens
  if ('object' == typeof len) tokens = len, len = 1;
  if (tokens) this.tokens = tokens;

  // start time for eta
  if (0 == this.curr) this.start = new Date;

  this.curr += len;

  // schedule render
  if (!this.renderThrottleTimeout) {
    this.renderThrottleTimeout = setTimeout(this.render.bind(this), this.renderThrottle);
  }

  // progress complete
  if (this.curr >= this.total) {
    if (this.renderThrottleTimeout) this.render();
    this.complete = true;
    this.terminate();
    this.callback(this);
    return;
  }
};

/**
 * Method to render the progress bar with optional `tokens` to place in the
 * progress bar's `fmt` field.
 *
 * @param {object} tokens
 * @api public
 */

ProgressBar.prototype.render = function (tokens) {
  clearTimeout(this.renderThrottleTimeout);
  this.renderThrottleTimeout = null;

  if (tokens) this.tokens = tokens;

  if (!this.stream.isTTY) return;

  var ratio = this.curr / this.total;
  ratio = Math.min(Math.max(ratio, 0), 1);

  var percent = ratio * 100;
  var incomplete, complete, completeLength;
  var elapsed = new Date - this.start;
  var eta = this.estimate(elapsed, percent);

  /* populate the bar template with percentages and timestamps */
  var str = this.fmt
    .replace(':current', this.curr)
    .replace(':total', this.total)
    .replace(':elapsed', isNaN(elapsed) ? '0.0' : (elapsed / 1000).toFixed(1))
    .replace(':eta', eta.value)
    .replace(':unit', eta.suffix)
    .replace(':percent', percent.toFixed(0) + '%');

  /* compute the available space (non-zero) for the bar */
  var availableSpace = Math.max(0, this.stream.columns - str.replace(':bar', '').length);
  var width = Math.min(this.width, availableSpace);

  /* TODO: the following assumes the user has one ':bar' token */
  completeLength = Math.round(width * ratio);
  complete = Array(completeLength + 1).join(this.chars.complete);
  incomplete = Array(width - completeLength + 1).join(this.chars.incomplete);

  /* fill in the actual progress bar */
  str = str.replace(':bar', complete + incomplete);

  /* replace the extra tokens */
  if (this.tokens) for (var key in this.tokens) str = str.replace(':' + key, this.tokens[key]);

  if (this.lastDraw !== str) {
    this.stream.cursorTo(0);
    this.stream.write(str);
    this.stream.clearLine(1);
    this.lastDraw = str;
  }
};

/**
 * Estimate the remaining time and return it in the largest unit possible
 *
 * @param {number} elapsed
 * @param {number} percent
 * @api private
 */
ProgressBar.prototype.estimate = function (elapsed, percent) {
  var eta = (percent == 100) ? 0 : elapsed * (this.total / this.curr - 1);
  eta /= 1000;
  
  var values = this.units.values;
  var labels = this.units.labels;
  var i = values.length - 1;
  var suffix = labels[i];
    
  if (isNaN(eta) || !isFinite(eta)) {
    return {
      eta: '0.0',
      suffix: suffix
    };
  }
  
  while (i > 0 && eta < values[i]) {
    i--;
  }
  suffix = labels[i];
  
  while (i > 0) {
    eta /= values[i--];
  }
  
  return {
    value: eta.toFixed(1),
    suffix: suffix
  };
};

/**
 * "update" the progress bar to represent an exact percentage.
 * The ratio (between 0 and 1) specified will be multiplied by `total` and
 * floored, representing the closest available "tick." For example, if a
 * progress bar has a length of 3 and `update(0.5)` is called, the progress
 * will be set to 1.
 *
 * A ratio of 0.5 will attempt to set the progress to halfway.
 *
 * @param {number} ratio The ratio (between 0 and 1 inclusive) to set the
 *   overall completion to.
 * @api public
 */

ProgressBar.prototype.update = function (ratio, tokens) {
  var goal = Math.floor(ratio * this.total);
  var delta = goal - this.curr;

  this.tick(delta, tokens);
};

/**
 * Terminates a progress bar.
 *
 * @api public
 */

ProgressBar.prototype.terminate = function () {
  if (this.clear && this.stream.isTTY) {
    this.stream.clearLine();
    this.stream.cursorTo(0);
  } else this.stream.write('\n');
};

/**
 * Logs a message. Accepts the same arguments as util.format.
 * @param {string} message The message to log
 * @api public
 */

ProgressBar.prototype.log = function () {
  if (this.stream.isTTY) {
    this.stream.clearLine();
    this.stream.cursorTo(0);
  }
  this.stream.write(util.format.apply(util, arguments)+'\n');
  if (this.stream.isTTY) {
    this.stream.write(this.lastDraw);
  }
};
