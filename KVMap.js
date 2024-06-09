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
	KEY_CFHOST = 'cfhost';
	KEY_PROXYS = 'proxys';
	
	//initial entry
	_proxys; _cfhost;
	//cache
	cachedProxys = []; cachedProxys80 = [];
	cachedCfhost = []; 
	//source
	cfhostFromKV = [];
	
	loadedProxys = false;
	loadedCfhost = false;
	puttingCfhost = false;
	proxy;
	constructor({KV, proxys = [], cfhost = []}) {
		this.KV = KV;
		this._proxys = proxys;
		this._cfhost = cfhost;
		this.proxy = this.randomProxy;
	}
	get proxys() {
		return { 443: [...this._proxys, ...this.cachedProxys], 80: [...this._proxys, ...this.cachedProxys80]}
	}
	get cfhost() {
		return [...this._cfhost, ...this.cachedCfhost]
	}
	get randomProxy() {
		return { 443: randFrom(this.proxys[443]), 80: randFrom(this.proxys[80]) }
	}
	loadCfhost() {
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
	}
	loadProxys() {
		if (this.loadedProxys) return Promise.resolve();
		return this.KVOp(this.KEY_PROXYS, 'get').then(r => {
			if (r) {
				if (r[0] instanceof Array) {
					this.cachedProxys = r[0];
					if (r[1]) this.cachedProxys80 = r[1];
				} else {
					this.cachedProxys = r;
				}
			}
			this.proxy = this.randomProxy;
			this.loadedProxys = true;
			console.log(`KV ${this.KEY_PROXYS} loaded ${this.proxys[443].length}(443),${this.proxys[80].length}(80)`)
			return this.proxys;
		})
	}
	async deleteProxy(host, port) {
		if (port != 443 || port != 80) return;
		while (! this.loadedProxys) {
			console.log(`${this.KEY_PROXYS} not loaded! try wait 20ms`)
			await delay(20);
		}
		let key = 'cachedProxys'+ (port==443?'':'80')
		let i = this[key].indexOf(host);
		if (i < 0) return;
		this[key].splice(i, 1);
		this.proxy[port] = randFrom(this.proxys[port]);
		this.KVOp(this.KEY_PROXYS, 'put', [this.cachedProxys,this.cachedProxys80])
			.then(r => { console.log(`proxy ${host+':'+port} deleted from KV`); });
	}
	async tagHost(host) {
		while (! this.loadedCfhost) {
			console.log(`${this.KEY_CFHOST} not loaded! try wait 20ms`)
			await delay(20);
		}
		if (! this.cfhost.includes(host))
			this.cachedCfhost.push(host);
		else 
			return;
		console.log(`cached ${host} ${this.cfhost.length}`)
		while (this.puttingCfhost) {
			console.log(`${this.KEY_CFHOST} is been putting! try wait 50ms`)
			await delay(50);
		}
		if (! this.puttingCfhost) {
			this.puttingCfhost = true;
			if (this.cfhostFromKV.length) {
				let r = await this.KVOp(this.KEY_CFHOST, 'get');
				let [ldiff, rdiff] = symmetricDifference(this.cachedCfhost, r, true);
				this.cachedCfhost.push(...rdiff);
				if (ldiff.length)
					await this.KVOp(this.KEY_CFHOST, 'put', this.cachedCfhost)
						.then(r => { console.log(`tagged ${ldiff} to KV`); })
				if (rdiff.length)
					console.log(`received new cfhost: ${rdiff}, ${r.length}(KV) ${this.cfhost.length}(cache)`)
			} else {
				await this.KVOp(this.KEY_CFHOST, 'put', this.cachedCfhost)
					.then(r => { console.log(`tagged ${this.cachedCfhost} to KV`); })
			}
			this.puttingCfhost = false;
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