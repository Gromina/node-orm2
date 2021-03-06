var ChainFind         = require("./ChainFind");
var Instance          = require("./Instance").Instance;
var LazyLoad          = require("./LazyLoad");
var ManyAssociation   = require("./Associations/Many");
var OneAssociation    = require("./Associations/One");
var ExtendAssociation = require("./Associations/Extend");
var Property          = require("./Property");
var Singleton         = require("./Singleton");
var Utilities         = require("./Utilities");
var Validators        = require("./Validators");
var ErrorCodes        = require("./ErrorCodes");
var Hook              = require("./Hook");
var AvailableHooks    = [
	"beforeCreate", "afterCreate",
	"beforeSave", "afterSave",
	"beforeValidation",
	"beforeRemove", "afterRemove",
	"afterLoad",
	"afterAutoFetch"
];

exports.Model = Model;

function Model(opts) {
	opts = opts || {};

	if (!Array.isArray(opts.id)) {
		opts.id = [ opts.id ];
	}

	var one_associations       = [];
	var many_associations      = [];
	var extend_associations    = [];
	var association_properties = [];
	var model_fields           = [];
	var allProperties          = {};

	var createHookHelper = function (hook) {
		return function (cb) {
			if (typeof cb !== "function") {
				delete opts.hooks[hook];
			} else {
				opts.hooks[hook] = cb;
			}
			return this;
		};
	};
	var createInstance = function (data, inst_opts, cb) {
		if (!inst_opts) {
			inst_opts = {};
		}

		var found_assoc = false, i, k;

		for (k in data) {
			if (k === "extra_field") continue;
			if (opts.properties.hasOwnProperty(k)) continue;
			if (inst_opts.extra && inst_opts.extra.hasOwnProperty(k)) continue;
			if (opts.id.indexOf(k) >= 0) continue;
			if (association_properties.indexOf(k) >= 0) continue;

			for (i = 0; i < one_associations.length; i++) {
				if (one_associations[i].name === k) {
					found_assoc = true;
					break;
				}
			}
			if (!found_assoc) {
				for (i = 0; i < many_associations.length; i++) {
					if (many_associations[i].name === k) {
						found_assoc = true;
						break;
					}
				}
			}
			if (!found_assoc) {
				delete data[k];
			}
		}

		var assoc_opts = {
			autoFetch      : inst_opts.autoFetch || false,
			autoFetchLimit : inst_opts.autoFetchLimit,
			cascadeRemove  : inst_opts.cascadeRemove
		};
		var pending  = 2;
		var instance = new Instance(model, {
			uid                    : inst_opts.uid, // singleton unique id
			id                     : opts.id,
			is_new                 : inst_opts.is_new || false,
			isShell                : inst_opts.isShell || false,
			data                   : data,
			autoSave               : inst_opts.autoSave || false,
			extra                  : inst_opts.extra,
			extra_info             : inst_opts.extra_info,
			driver                 : opts.driver,
			table                  : opts.table,
			hooks                  : opts.hooks,
			methods                : opts.methods,
			validations            : opts.validations,
			one_associations       : one_associations,
			many_associations      : many_associations,
			extend_associations    : extend_associations,
			association_properties : association_properties
		});
		instance.on("ready", function (err) {
			if (--pending > 0) return;
			if (typeof cb === "function") {
				return cb(err, instance);
			}
		});
		if (model_fields !== null) {
			LazyLoad.extend(instance, model, opts.properties);
		}
		OneAssociation.extend(model, instance, opts.driver, one_associations, assoc_opts);
		ManyAssociation.extend(model, instance, opts.driver, many_associations, assoc_opts, createInstance);
		ExtendAssociation.extend(model, instance, opts.driver, extend_associations, assoc_opts);

		OneAssociation.autoFetch(instance, one_associations, assoc_opts, function () {
			ManyAssociation.autoFetch(instance, many_associations, assoc_opts, function () {
				ExtendAssociation.autoFetch(instance, extend_associations, assoc_opts, function () {
					Hook.wait(instance, opts.hooks.afterAutoFetch, function (err) {
						if (--pending > 0) return;
						if (typeof cb === "function") {
							return cb(err, instance);
						}
					});
				});
			});
		});
		return instance;
	};

	var model = function () {
	    var instance, i;

	    var data = arguments.length > 1 ? arguments : arguments[0];

	    if (Array.isArray(opts.id) && Array.isArray(data)) {
	        if (data.length == opts.id.length) {
	            var data2 = {};
	            for (i = 0; i < opts.id.length; i++) {
	                data2[opts.id[i]] = data[i++];
	            }

	            return createInstance(data2, { isShell: true });
	        }
	        else {
	            var err = new Error('Model requires ' + opts.id.length + ' keys, only ' + data.length + ' were provided');
	            err.model = opts.table;

	            throw err;
	        }
	    }
	    else if (typeof data === "number" || typeof data === "string") {
	        var data2 = {};
	        data2[opts.id[0]] = data;

	        return createInstance(data2, { isShell: true });
	    } else if (typeof data === "undefined") {
	        data = {};
	    }

	    var isNew = false;

	    for (i = 0; i < opts.id.length; i++) {
	        if (!data.hasOwnProperty(opts.id[i])) {
	            isNew = true;
	            break;
	        }
	    }

	    if (opts.id.length === 1 && opts.id[0] != 'id') {
	        isNew = true; //Dubiously assume that it is a new instance if we're using custom keys
	    }

	    return createInstance(data, {
	        is_new: isNew,
	        autoSave: opts.autoSave,
	        cascadeRemove: opts.cascadeRemove
	    });
	};

	model.allProperties = allProperties;
	model.properties    = opts.properties;
	model.settings      = opts.settings;

	model.drop = function (cb) {
		if (arguments.length === 0) {
			cb = function () {};
		}
		if (typeof opts.driver.drop === "function") {
			opts.driver.drop({
				table             : opts.table,
				properties        : opts.properties,
				one_associations  : one_associations,
				many_associations : many_associations
			}, cb);

			return this;
		}

		return cb(ErrorCodes.generateError(ErrorCodes.NO_SUPPORT, "Driver does not support Model.drop()", { model: opts.table }));
	};

	model.sync = function (cb) {
		if (arguments.length === 0) {
			cb = function () {};
		}
		if (typeof opts.driver.sync === "function") {
			try {
				opts.driver.sync({
					extension           : opts.extension,
					id                  : opts.id,
					table               : opts.table,
					properties          : opts.properties,
					allProperties       : allProperties,
					indexes             : opts.indexes || [],
					customTypes         : opts.db.customTypes,
					one_associations    : one_associations,
					many_associations   : many_associations,
					extend_associations : extend_associations
				}, cb);
			} catch (e) {
				return cb(e);
			}

			return this;
		}

		return cb(ErrorCodes.generateError(ErrorCodes.NO_SUPPORT, "Driver does not support Model.sync()", { model: opts.table }));
	};

	model.get = function () {
		var conditions = {};
		var options    = {};
		var ids        = Array.prototype.slice.apply(arguments);
		var cb         = ids.pop();

		if (typeof cb !== "function") {
		    throw ErrorCodes.generateError(ErrorCodes.MISSING_CALLBACK, "Missing Model.get() callback", { model: opts.table });
		}

		if (typeof ids[ids.length - 1] === "object" && !Array.isArray(ids[ids.length - 1])) {
			options = ids.pop();
		}

		if (ids.length === 1 && Array.isArray(ids[0])) {
			ids = ids[0];
		}

		if (ids.length !== opts.id.length) {
		    throw ErrorCodes.generateError(ErrorCodes.PARAM_MISMATCH, "Model.get() IDs number mismatch (" + opts.id.length + " needed, " + ids.length + " passed)", { model: opts.table });
		}

		for (var i = 0; i < opts.id.length; i++) {
			conditions[opts.id[i]] = ids[i];
		}

		if (!options.hasOwnProperty("autoFetch")) {
			options.autoFetch = opts.autoFetch;
		}
		if (!options.hasOwnProperty("autoFetchLimit")) {
			options.autoFetchLimit = opts.autoFetchLimit;
		}
		if (!options.hasOwnProperty("cascadeRemove")) {
			options.cascadeRemove = opts.cascadeRemove;
		}

		opts.driver.find(model_fields, opts.table, conditions, { limit: 1 }, function (err, data) {
			if (err) {
				return cb(ErrorCodes.generateError(ErrorCodes.QUERY_ERROR, err.message, { originalCode: err.code }));
			}
			if (data.length === 0) {
			    return cb(ErrorCodes.generateError(ErrorCodes.NOT_FOUND, "Not found", { model: opts.table }));
			}

			var uid = opts.driver.uid + "/" + opts.table + "/" + ids.join("/");

			Singleton.get(uid, {
				cache      : (options.hasOwnProperty("cache") ? options.cache : opts.cache),
				save_check : opts.settings.get("instance.cacheSaveCheck")
			}, function (cb) {
				return createInstance(data[0], {
					uid            : uid,
					autoSave       : options.autoSave,
					autoFetch      : (options.autoFetchLimit === 0 ? false : options.autoFetch),
					autoFetchLimit : options.autoFetchLimit,
					cascadeRemove  : options.cascadeRemove
				}, cb);
			}, cb);
		});

		return this;
	};

	model.find = function () {
		var options    = {};
		var conditions = null;
		var cb         = null;
		var order      = null;
		var merge      = null;

		for (var i = 0; i < arguments.length; i++) {
			switch (typeof arguments[i]) {
				case "number":
					options.limit = arguments[i];
					break;
				case "object":
					if (Array.isArray(arguments[i])) {
						if (arguments[i].length > 0) {
							order = arguments[i];
						}
					} else {
						if (conditions === null) {
							conditions = arguments[i];
						} else {
							if (options.hasOwnProperty("limit")) {
								arguments[i].limit = options.limit;
							}
							options = arguments[i];

							if (options.hasOwnProperty("__merge")) {
								merge = options.__merge;
								merge.select = Object.keys(options.extra);
								delete options.__merge;
							}
							if (options.hasOwnProperty("order")) {
								order = options.order;
								delete options.order;
							}
						}
					}
					break;
				case "function":
					cb = arguments[i];
					break;
				case "string":
					if (arguments[i][0] === "-") {
						order = [ arguments[i].substr(1), "Z" ];
					} else {
						order = [ arguments[i] ];
					}
					break;
			}
		}

		if (!options.hasOwnProperty("cache")) {
			options.cache = opts.cache;
		}
		if (!options.hasOwnProperty("autoFetchLimit")) {
			options.autoFetchLimit = opts.autoFetchLimit;
		}
		if (!options.hasOwnProperty("cascadeRemove")) {
			options.cascadeRemove = opts.cascadeRemove;
		}

		if (order) {
			order = Utilities.standardizeOrder(order);
		}
		if (conditions) {
			conditions = Utilities.checkConditions(conditions, one_associations);
		}

		var chain = new ChainFind(model, {
			only         : options.only || model_fields,
			id           : opts.id,
			table        : opts.table,
			driver       : opts.driver,
			conditions   : conditions,
			associations : many_associations,
			limit        : options.limit,
			order        : order,
			merge        : merge,
			offset       : options.offset,
			newInstance  : function (data, cb) {
				var uid = opts.driver.uid + "/" + opts.table + (merge ? "+" + merge.from.table : "");
				for (var i = 0; i < opts.id.length; i++) {
					uid += "/" + data[opts.id[i]];
				}

				Singleton.get(uid, {
					cache      : options.cache,
					save_check : opts.settings.get("instance.cacheSaveCheck")
				}, function (cb) {
					return createInstance(data, {
						uid            : uid,
						autoSave       : opts.autoSave,
						autoFetch      : (options.autoFetchLimit === 0 ? false : (options.autoFetch || opts.autoFetch)),
						autoFetchLimit : options.autoFetchLimit,
						cascadeRemove  : options.cascadeRemove,
						extra          : options.extra,
						extra_info     : options.extra_info
					}, cb);
				}, cb);
			}
		});

		if (typeof cb !== "function") {
			return chain;
		}

		chain.run(cb);

		return this;
	};

	model.all = model.find;

	model.one = function () {
		var args = Array.prototype.slice.apply(arguments);
		var cb   = null;

		// extract callback
		for (var i = 0; i < args.length; i++) {
			if (typeof args[i] === "function") {
				cb = args.splice(i, 1)[0];
				break;
			}
		}

		if (cb === null) {
		    throw ErrorCodes.generateError(ErrorCodes.MISSING_CALLBACK, "Missing Model.one() callback", { model: opts.table });
		}

		// add limit 1
		args.push(1);
		args.push(function (err, results) {
			if (err) {
				return cb(err);
			}
			return cb(null, results.length ? results[0] : null);
		});

		return this.find.apply(this, args);
	};

	model.count = function () {
		var conditions = null;
		var cb         = null;

		for (var i = 0; i < arguments.length; i++) {
			switch (typeof arguments[i]) {
				case "object":
					conditions = arguments[i];
					break;
				case "function":
					cb = arguments[i];
					break;
			}
		}

		if (typeof cb !== "function") {
		    throw ErrorCodes.generateError(ErrorCodes.MISSING_CALLBACK, "Missing Model.count() callback", { model: opts.table });
		}

		if (conditions) {
			conditions = Utilities.checkConditions(conditions, one_associations);
		}

		opts.driver.count(opts.table, conditions, {}, function (err, data) {
			if (err || data.length === 0) {
				return cb(err);
			}
			return cb(null, data[0].c);
		});
		return this;
	};

	model.aggregate = function () {
		var conditions = {};
		var properties = [];

		for (var i = 0; i < arguments.length; i++) {
			if (typeof arguments[i] === "object") {
				if (Array.isArray(arguments[i])) {
					properties = arguments[i];
				} else {
					conditions = arguments[i];
				}
			}
		}

		if (conditions) {
			conditions = Utilities.checkConditions(conditions, one_associations);
		}

		return new require("./AggregateFunctions")({
			table       : opts.table,
			driver_name : opts.driver_name,
			driver      : opts.driver,
			conditions  : conditions,
			properties  : properties
		});
	};

	model.exists = function () {
		var ids = Array.prototype.slice.apply(arguments);
		var cb  = ids.pop();

		if (typeof cb !== "function") {
		    throw ErrorCodes.generateError(ErrorCodes.MISSING_CALLBACK, "Missing Model.exists() callback", { model: opts.table });
		}

		var conditions = {}, i;

		if (ids.length === 1 && typeof ids[0] === "object") {
			if (Array.isArray(ids[0])) {
				for (i = 0; i < opts.id.length; i++) {
					conditions[opts.id[i]] = ids[0][i];
				}
			} else {
				conditions = ids[0];
			}
		} else {
			for (i = 0; i < opts.id.length; i++) {
				conditions[opts.id[i]] = ids[i];
			}
		}

		if (conditions) {
			conditions = Utilities.checkConditions(conditions, one_associations);
		}

		opts.driver.count(opts.table, conditions, {}, function (err, data) {
			if (err || data.length === 0) {
				return cb(err);
			}
			return cb(null, data[0].c > 0);
		});
		return this;
	};

	model.create = function () {
		var Instances = [];
		var options = {};
		var cb = null, idx = 0, single = false;
		var createNext = function () {
			if (idx >= Instances.length) {
				return cb(null, single ? Instances[0] : Instances);
			}

			Instances[idx] = createInstance(Instances[idx], {
				is_new    : true,
				autoSave  : opts.autoSave,
				autoFetch : false
			}, function (err) {
				if (err) {
					err.index = idx;
					err.instance = Instances[idx];
					return cb(err);
				}
				Instances[idx].save(function (err) {
					if (err) {
						err.index = idx;
						err.instance = Instances[idx];

						return cb(err);
					}

					idx += 1;
					createNext();
				});
			});
		};

		for (var i = 0; i < arguments.length; i++) {
			switch (typeof arguments[i]) {
				case "object":
					if ( !single && Array.isArray(arguments[i]) ) {
						Instances = Instances.concat(arguments[i]);
					} else if (i === 0) {
						single = true;
						Instances.push(arguments[i]);
					} else {
						options = arguments[i];
					}
					break;
				case "function":
					cb = arguments[i];
					break;
			}
		}

		createNext();

		return this;
	};

	model.clear = function (cb) {
		opts.driver.clear(opts.table, function (err) {
			if (typeof cb === "function") cb(err);
		});

		return this;
	};

	Object.defineProperty(model, "table", {
		value: opts.table,
		enumerable: false
	});
	Object.defineProperty(model, "id", {
		value: opts.id,
		enumerable: false
	});
	Object.defineProperty(model, "properties", {
		value: opts.properties,
		enumerable: false
	});
	Object.defineProperty(model, "uid", {
	    value: opts.driver.uid + "/" + opts.table + "/" + opts.id.join("/"),
        enumerable: false
	});

	// Standardize validations
	for (var k in opts.validations) {
		if (!Array.isArray(opts.validations[k])) {
			opts.validations[k] = [ opts.validations[k] ];
		}
	}

	// standardize properties
	for (k in opts.properties) {
		opts.properties[k] = Property.normalize(opts.properties[k], opts.db.customTypes, opts.settings);
		opts.properties[k].klass = 'primary';
		allProperties[k] = opts.properties[k];

		if (opts.id.indexOf(k) != -1) {
			opts.properties[k].key = true;
		}

		if (opts.properties[k].lazyload !== true && model_fields.indexOf(k) == -1) {
			model_fields.push(k);
		}
		if (opts.properties[k].required) {
			// Prepend `required` validation
			if(opts.validations.hasOwnProperty(k)) {
				opts.validations[k].splice(0, 0, Validators.required());
			} else {
				opts.validations[k] = [Validators.required()];
			}
		}
	}

	for (var i = 0; i < opts.id.length; i++) {
		k = opts.id[i];
		allProperties[k] = opts.properties[k] || {
			type: 'serial', rational: 'false', key: true, klass: 'key'
		};
	}
	model_fields = opts.id.concat(model_fields);

	// setup hooks
	for (k in AvailableHooks) {
		model[AvailableHooks[k]] = createHookHelper(AvailableHooks[k]);
	}

	OneAssociation.prepare(model, one_associations, association_properties, model_fields);
	ManyAssociation.prepare(model, many_associations);
	ExtendAssociation.prepare(opts.db, model, extend_associations);

	return model;
}
