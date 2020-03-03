import ora from 'ora';
import { Whatsapp } from '../api/whatsapp';
import {ConfigObject} from '../api/model/index';
import * as path from 'path';
import { isAuthenticated, isInsideChat, retrieveQR, randomMouseMovements } from './auth';
import { initWhatsapp, injectApi } from './browser';
const spinner = ora();

import {ev} from './events'

let shouldLoop = true;
const fs = require('fs');
var pjson = require('../../package.json');
const timeout = ms => {
  return new Promise(resolve => setTimeout(resolve, ms, 'timeout'));
}
let waPage;
let qrTimeout;

/**
 * Should be called to initialize whatsapp client
 * @param sessionId Custom id for the session, every phone should have it's own sessionId.
 * @param config The extended custom configuration
 * @param customUserAgent A custom user agent to set on the browser page.
 */
export async function create(sessionId?: string, config?:ConfigObject, customUserAgent?:string) {
  waPage = undefined;
  qrTimeout = undefined;
  shouldLoop = true;
  if (!sessionId) sessionId = 'session';
  spinner.start('Initializing whatsapp');
  waPage = await initWhatsapp(sessionId, config, customUserAgent);
  spinner.succeed();
  const throwOnError=config&&config.throwErrorOnTosBlock==true;

  const PAGE_UA =  await waPage.evaluate('navigator.userAgent');
  const BROWSER_VERSION = await waPage.browser().version();
  const SULLA_HOTFIX_VERSION = pjson.version;
  //@ts-ignore
  const WA_VERSION = await waPage.evaluate(()=>window.Debug?window.Debug.VERSION:'I think you have been TOS_BLOCKed')
  

  //@ts-ignore
  const canInjectEarly = await waPage.evaluate(() => {return (typeof webpackJsonp !== "undefined")});
  //@ts-ignore
  const BROWSER_ID = canInjectEarly?await waPage.evaluate(() => {return webpackJsonp([],null,['bhaehigaaa'])?webpackJsonp([],null,['bhaehigaaa']).default.getBrowserId():''}):'';
  
  console.log('Debug Info', {
    WA_VERSION,
    PAGE_UA,
    SULLA_HOTFIX_VERSION,
    BROWSER_VERSION,
    BROWSER_ID
  });
  
  if(canInjectEarly) {
    spinner.start('Injecting api');
    waPage = await injectApi(waPage);
    spinner.start('WAPI injected');
  } else {
    if(throwOnError) throw Error('TOSBLOCK');
    console.log('Possilby TOS_BLOCKed')
  }

  spinner.start('Authenticating');
  let authenticated = await isAuthenticated(waPage);
  let autoRefresh = config ? config.autoRefresh : false;
 
  const qrLoop = async () => {
    if(!shouldLoop) return;
    console.log(' ')
    await retrieveQR(waPage,sessionId,autoRefresh,throwOnError);
    console.log(' ')
    qrTimeout = timeout((config?(config.qrRefreshS || 10):10)*1000);
    await qrTimeout;
    if(autoRefresh)qrLoop();
  };

  if (authenticated) {
    spinner.succeed('Authenticated');
  } else {
    spinner.info('Authenticate to continue');
    const qrSpin = ora();
    qrSpin.start('Loading QR');
    qrSpin.succeed();
    qrLoop();
    const race = [];
    race.push(isInsideChat(waPage).toPromise());
    if(config&&config.killTimer){
      race.push(timeout(config.killTimer*1000))
    }
    const result = await Promise.race(race);
    if(result=='timeout') {
      console.log('Session timed out. Shutting down')
      await kill();
      throw new Error('QR Timeout');
      
    }
    shouldLoop = false;
    clearTimeout(qrTimeout);
    spinner.succeed();
  }
  const pre = canInjectEarly? 'Rei':'I';
  spinner.start(`${pre}njecting api`);
  waPage = await injectApi(waPage);
  spinner.succeed(`WAPI ${pre}njected`);

  if(canInjectEarly) {
    //check if page is valid after 5 seconds
    spinner.start('Checking if session is valid');
    await timeout(5000);
  }

  //@ts-ignore
  const VALID_SESSION = await waPage.evaluate(()=>window.Store&&window.Store.Msg?true:false);
  if(VALID_SESSION)  {
    spinner.succeed('Whatsapp is ready');
    const localStorage = JSON.parse(await waPage.evaluate(() => {
      return JSON.stringify(window.localStorage);
  }));
  const sessionjsonpath = path.join(process.cwd(), `${sessionId || 'session'}.data.json`);
  const sessionData = {
    WABrowserId: localStorage.WABrowserId,
    WASecretBundle: localStorage.WASecretBundle,
    WAToken1: localStorage.WAToken1,
    WAToken2: localStorage.WAToken2
};

ev.emit(`sessionData${sessionId?`.${sessionId}`:``}`, sessionData, sessionId);

  fs.writeFile(sessionjsonpath, JSON.stringify(sessionData), (err) => {
  if (err) {  console.error(err);  return; };
});
    return new Whatsapp(waPage);
  }
  else {
    spinner.fail('The session is invalid. Retrying')
    await kill()
    return await create(sessionId,config,customUserAgent);
  }
}

const kill = async () => {
  shouldLoop = false;
if(qrTimeout) clearTimeout(qrTimeout);
  await waPage.close();
  await waPage.browser().close();
}
