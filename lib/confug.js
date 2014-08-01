(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], function () {
      return factory(root);
    });
  } else if (typeof exports !== 'undefined') {
    module.exports = factory(root);
  } else {
    root.confug = factory(root);
  }

}(this, function (global) {
  'use strict';

  var confug;

  var _allowedTypes = [ typeof '', typeof true, typeof 1 ] // TODO: (maybe) support function if it returns one of these types
    , _reStageAbbreviation = /^[a-z][\w\d]+$/
    , _defaultStages = [
          { name: 'development', abbrev: 'dev' }
        , { name: 'testing', abbrev: 'test' }
        , { name: 'staging', abbrev: 'stage' }
        , { name: 'production', abbrev: 'prod' }
      ]
    , _globalEnv = {}
    , _configCache = []
    , _defaultOptions = {
          singleton: true
        , fallbackGlobal: true
        , nestedEnv: true
        , stages: null
        , consts: null
        , initial: null
        , env: null
        , overwrites: null
      };

  // import global env, if exists
  if (typeof global !== 'undefined') {
    if (typeof global.process === 'object' && typeof global.process.env === 'object') {
      _globalEnv = global.process.env;
    }
    else if (typeof global.env === 'object') { // browser env specified
      _globalEnv = global.env;
    }
    else { // global.process existence just a coinkydink (doesn't contain env property)
      _globalEnv = global;
    }
  }

  confug = function(env, passedOptions) {
    var opts = {}
      , config;

    // no env specified.  exists in global? env is non-Stage object though (options)
    if (typeof passedOptions === 'undefined' && typeof env === 'object' && !(env instanceof Stage)) {
      passedOptions = env;
      env = null;
    }

    // init opts with defaults
    for (var k in _defaultOptions) {
      opts[k] = _defaultOptions[k];
    }

    // import options
    if (typeof passedOptions === 'object') {
      for (var k in passedOptions) {
        if (false === _defaultOptions.hasOwnProperty(k)) {
          throw new Error('Confug Error - Invalid confug option "' + k + '"');
        }

        opts[k] = passedOptions[k];
      }
    }

    // if Config STAGE constants aren't init (via initStages), init them with the defaults
    if (null === Config.STAGE) {
      initStages(opts.stages || _defaultStages);
    }

    // grab env from environment global
    env = env;
    if (true === opts.fallbackGlobal) {
      env = env || _globalEnv.NODE_ENV || _globalEnv.CLIENT_ENV || _globalEnv.ENV;
    }

    // expand non-Stage env
    if (!(env instanceof Stage)) {
      env = Config.STAGE[env] || Config.STAGE['production'];
    }

    // limit to one config per environment
    if (true === opts.singleton && _configCache.length > 0) {
      for (var i=0; i < _configCache.length; i++) {
        var cached = _configCache[i];
        if (cached.env === env) {
          if (typeof passedOptions !== 'undefined') {
            // FIXME: (maybe) should this be silently ignored?
            throw new Error('Confug Error - Cannot pass options when a config has already been created');
          }

          return cached;
        }
      }
    }

    config = new Config(env, opts);

    if (true === opts.singleton) {
      _configCache.push(config);
    }

    return config;
  };

  var initStages = confug.initStages = function(stageNames) {
    if (null !== Config.STAGE) {
      throw new Error('Confug Error - Stages have already been initlaized');
    }
    if (typeof stageNames !== 'object' || typeof stageNames.length === 'undefined') {
      throw new Error('Confug Error - Invalid stage names.  Expecting array of stages.');
    }

    var stages = {};

    for (var i=0; i < stageNames.length; i++) {
      var stageName = stageNames[i]
        , stage;

      if (typeof stageName === 'object') {
        stage = new Stage(stageName.name || stageName[0], stageName.abbrev || stageName[1]);
      }
      else {
        stage = new Stage(stageName);
      }

      stages[stage.name] = stage;

      if (typeof Config.prototype[stage.abbrev] !== 'undefined') {
        throw new Error('Confug Error - Invalid stage abbreviation "' + stage.abbrev + '": Collision');
      }
      else if (!_reStageAbbreviation.test(stage.abbrev)) {
        throw new Error('Confug Error - Invalid stage abbreviation "' + stage.abbrev + '": Bad characters');
      }

      Config.prototype[stage.abbrev] = function() {
        return this.env === stage;
      };
    }

    Config.STAGE = stages;
  };

  var env = confug.env = function(key, def) {
    if (def instanceof Error && typeof _globalEnv[key] === 'undefined') {
      throw def;
    }
    return _globalEnv[key] || def;
  };

  // so we can be strict with our stage comparisons
  var Stage = confug.Stage = function(name, abbrev) {
    this.name = name;
    this.abbrev = abbrev || name;
  };

  Stage.prototype.toString = function() {
    return this.name;
  };

  var Config = confug.Config = function(env, opts) {
    if (typeof env !== 'object' && typeof env !== 'undefined') {
      env = Config.STAGE[env];
    }
    if (typeof env === 'undefined') {
      throw new Error('Confug Error - Environment required');
    }

    opts = opts || {};
    if (typeof opts !== 'object') {
      throw new Error('Confug Error - Invalid options');
    }

    this.env = env;

    console.log('new Config, env: ', env)

    this._values = {};
    this._consts = opts.consts || {};

    // init values with constants
    this._extend(this._consts, true);

    // inheritence order
    this._extend(opts.initial); // apply env-independent defaults
    if (null !== opts.env && typeof opts.env === 'object') {
      // apply defaults for env
      if (true === opts.nestedEnv) { // need to determine correct env config data (server, usually)
        this._extend(opts.env[this.env.name] || opts.env[this.env.abbrev]);
      }
      else { // env data is the current environment (client, usually)
        this._extend(opts.env);
      }
    }
    this._extend(opts.overwrites); // apply user passed options
  };

  Config.prototype._validType = function(val) {
    return false !== _allowedTypes.indexOf(typeof val);
  };

  Config.prototype._extend = function(addl, bForce) {
    if (null === addl || typeof addl !== 'object') {
      // FIXME: (maybe) should this not be silently ignored?
      // throw new Error('Confug Error - Invalid config template');
      return;
    }

    for (var k in addl) {
      if (!this._validType(addl[k])) {
        throw new Error('Confug Error - Type "' + typeof addl[k] + '" not supported in config');
      }

      // don't overwrite constants
      if (true === bForce || typeof this._consts[k] === 'undefined') {
        this._values[k] = addl[k];
      }
    }

    return addl;
  };

  // lookup matches start of key, example 'db:' will match all db keys
  //  can also be regexp
  // bDontStrip determines whether to strip out the matching part of the lookup.
  //  ex lookup=db:, result would be object like 'host' less the db: namespace
  Config.prototype.get = function(lookup, bDontStrip) {
    if (typeof lookup === 'undefined') {
      return this._values;
    }
    if (typeof lookup === 'string' && typeof this._values[lookup] !== 'undefined') {
      return this._values[lookup];
    }

    var ret = {}
      , matchingKeys = 0
      , regex = lookup instanceof RegExp
      , lookuplen;

    // no partial namespace lookups for non-regex
    if (false === regex && lookup[lookup.length - 1] !== ':') {
      lookup += ':';
    }

    lookuplen = lookup.length;

    for (var key in this._values) {
      var nkey = key;
      if (regex) {
        if (true === lookup.test(key)) {
          if (!bDontStrip) {
            nkey = key.replace(lookup, '');
          }
          ret[nkey] = this._values[key];
          matchingKeys++;
        }
      }
      else if (0 === key.indexOf(lookup)) {
        if (!bDontStrip) {
          nkey = key.substr(lookuplen);
        }
        ret[nkey] = this._values[key];
        matchingKeys++;
      }
    }

    if (0 === matchingKeys) {
      return; // not found, return undefined
    }
    else {
      return ret; // return all matching
    }
  };

  // support?
  // Config.prototype.set = function(key, val) {
  //   if (typeof key === 'object' && typeof val === 'undefined') {
  //     return this.extend(key); // obj lit passed
  //   }

  //   return this._values[key] = val;
  // };

  Config.prototype.is = function(envs) {
    if (typeof envs === 'string') {
      return this.env.name == envs;
    }
    else if (envs instanceof Stage) {
      return this.env.name == envs.name;
    }
    else if (typeof envs === 'object' && typeof envs.length !== 'undefined') {
      for (var i=0; i < envs.length; i++) {
        if (this.is(envs[i])) {
          return true;
        }
      }

      return false;
    }

    throw new Error('Confug Error - Invalid lookup environments specified');
  };

  Config.STAGE = null; // populated by factory or confug.initStages

  return confug;
}));
