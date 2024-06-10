export { default as inCfSubNet } from "./cfcidr";

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set
const union = (a, b) => [ ...new Set([...a, ...b]) ];
const difference = (a, b) => {
	const s = new Set(a);
	for (const e of b) 
		s.delete(e);
	return [...s];
};
function symmetricDifference(a, b, seperate=false) {
	const _a = new Set(a);
	let _b;
	if (seperate) _b = new Set();
	else _b = _a;
	for (const e of b) 
		_a.has(e)? _a.delete(e): _b.add(e);
	return seperate? [[..._a], [..._b]]: [..._a];
}
export const randFrom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const delay = (t) => new Promise(resolve => { setTimeout(resolve, t); });

export default class KVMap {
	KV;
	KEY_PROXYS = 'proxys';
	KEY_CFHOST = 'cfhost';
	KEY_HOST = 'host';
	
	//initial entry
	_proxys; _cfhost; _host;
	//cache
	proxysCache = [[],[]];
	cfhostCache = [];
	hostCache = [];
	//source
	cfhostRaw = [];
	hostRaw = [];
	
	proxy;
	proxysLoaded;
	cfhostLoaded;
	cfhostPutting;
	hostPutting;
	constructor({KV, proxys = [[],[]], cfhost = [], host = []}) {
		this.KV = KV;
		this._proxys = proxys;
		this._cfhost = cfhost;
		this._host = host;
		this.proxy = this.randomProxy;
	}
	get proxys() {
		return { 443: [...this._proxys, ...this.proxysCache[0]], 80: [...this._proxys, ...this.proxysCache[1]]}
	}
	get randomProxy() {
		return { 443: randFrom(this.proxys[443]), 80: randFrom(this.proxys[80]) }
	}
	get cfhost() {
		return [...this._cfhost, ...this.cfhostCache]
	}
	get host() {
		return [...this._host, ...this.hostCache]
	}
	/* loadCfhost() {
		if (this.loadedCfhost) return;
		this.KVOp(this.KEY_CFHOST, 'get').then(async r => {
			if (r) {
				if (r.find(e => this._cfhost.includes(e))) {
					r = difference(r, this._cfhost);
					//update to KV
					this.puttingCfhost = true;
					this.KVOp(this.KEY_CFHOST, 'put', r.length?r:'').then(()=>{ this.puttingCfhost = false; })
				}
				this.cfhostFromKV = r;
				this.cachedCfhost = r;
			}
			this.loadedCfhost = true;
			console.log(`KV ${this.KEY_CFHOST} loaded ${this.cfhost.length}`)
			return this.cfhost;
		})
	} */
	loadCfhost() {
		return this.loadKey(this.KEY_CFHOST);
	}
	loadHost() {
		return this.loadKey(this.KEY_HOST);
	}
	loadKey(key) {
		if (this[key+'Loaded']) return Promise.resolve();
		return this.KVOp(key, 'get').then(r => {
			if (r) {
				if (r.find(e => this['_'+key].includes(e))) {
					r = difference(r, this['_'+key]);
					//update to KV
					this[key+'Putting'] = true;
					this.KVOp(key, 'put', r.length?r:'').then(()=>{ this[key+'Putting'] = false; })
				}
				this[key+'Raw'] = r;
				this[key+'Cache'] = r;
			}
			this[key+'Loaded'] = true;
			console.log(`KV ${key} loaded ${this[key].length}`)
			return this[key];
		})
	}
	loadProxys() {
		if (this.proxysLoaded) return Promise.resolve();
		return this.KVOp(this.KEY_PROXYS, 'get').then(r => {
			if (r) {
				if (r[0] instanceof Array) {
					r.forEach((a,i) => this.proxysCache[i]=a)
				} else {
					this.proxysCache[0] = r;
				}
			}
			this.proxy = this.randomProxy;
			this.proxysLoaded = true;
			console.log(`KV ${this.KEY_PROXYS} loaded ${this.proxys[443].length}(443) ${this.proxys[80].length}(80)`)
			return this.proxys;
		})
	}
	async deleteProxy(host, port) {
		if (port != 443 || port != 80) return;
		while (! this.proxysLoaded) {
			console.log(`${this.KEY_PROXYS} not loaded! try wait 20ms`)
			await delay(20);
		}
		let idx = port == 443 ? 0 : 1
		let i = this.proxysCache[idx].indexOf(host);
		if (i < 0) return;
		this.proxysCache[idx].splice(i, 1);
		this.proxy[port] = randFrom(this.proxys[port]);
		this.KVOp(this.KEY_PROXYS, 'put', this.proxysCache)
			.then(r => { console.log(`proxy ${host+':'+port} deleted from KV`); });
	}
	tagCfhost(host) {
		this.tag(this.KEY_CFHOST, host);
	}
	tagHost(host) {
		this.tag(this.KEY_HOST, host);
	}
	async tag(key, host) {
		while (! this[key+'Loaded']) {
			console.log(`${key} not loaded! try wait 20ms`)
			await delay(20);
		}
		let keyCache = key+'Cache';
		if (! this[key].includes(host))
			this[keyCache].push(host);
		else 
			return;
		console.log(`cached ${host} ${this[key].length}`)
		let keyPutting = key+'Putting';
		while (this[keyPutting]) {
			console.log(`${key} is been putting! try wait 50ms`)
			await delay(50);
		}
		if (! this[keyPutting]) {
			this[keyPutting] = true;
			if (this[key+'Raw'].length) {
				let r = await this.KVOp(key, 'get');
				let [ldiff, rdiff] = symmetricDifference(this[keyCache], r, true);
				this[keyCache].push(...rdiff);
				if (ldiff.length)
					await this.KVOp(key, 'put', this[keyCache])
						.then(r => { console.log(`tagged ${ldiff} to KV`); })
				if (rdiff.length)
					console.log(`received new ${key}: ${rdiff}, ${r.length}(KV) ${this[key].length}(cache)`)
			} else {
				await this.KVOp(key, 'put', this[keyCache])
					.then(r => { console.log(`tagged ${this[keyCache]} to KV`); })
			}
			this[keyPutting] = false;
		}
	}
	// key, get 
	// key, put,  string|Array|Object
	// key, push, arg0, arg1, ...
	// key, set,  arg0, arg1
	async KVOp(key, op, ...args){
		let val;
		if (op == 'put') {
			args = args[0]
		} else if (/push|set/.test(op)) {
			val = await this.KVApi('get', key);
			if (val) {
				if (val instanceof Array) {
					if (op == 'push') 
						val.push(...args);
				} else if (val.toString() == '[object Object]') {
					if (op == 'set')
						val[args[0]] = args[1]
				}
				args = val
			}
			op = 'put'
		}
		return await this.KVApi(op, key, args);
	}
	/**
	  * op: get,put,list,delete
	  * args: key, value(string,object,array)
	  */
	async KVApi(op, ...args){
		let val;
		if (op == 'get') 
			args = args.slice(0, 1)
		try {
			if (op == 'put' && typeof args[1] == 'object') {
				args[1] = JSON.stringify(args[1]);
			}
			val = await this.KV[op](...args);
			if (op == 'get' && val && /^\[.*\]$/.test(val)) {
				val = JSON.parse(val);
			}
		} catch (err) {
			console.error('KV error', err);
		}
		return val;
	}
}