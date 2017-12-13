'use strict'
const logobject = require('./log');
// 只检查以下几个资源文件在不同target中是否一致
const SourceTags = ["Resources","Sources","Frameworks","CopyFiles"];
/**
 * 检查文件是否漏选target
 * @param {Object} targetInfo {targetname : Map} 
 *                 举例:{EQHexin : {Resources : 1D60588D0D05DD3D006BFB54,...},...} 
 * @param {Object} allSourceMap {resouceTagIdentifier : Map}
 *                 举例: {1D60588D0D05DD3D006BFB54 : {jiaoyi.png in Resources: 3DB8BF241AE51FDE00DD74F8,...},...}
 */
async function checkTargetConsistency(targetInfo,allSourceMap){
    let infoMap1 = targetInfo['EQHexin'];
    let infoMap2 = targetInfo['EQHexinB'];
    let infoMap3 = targetInfo['EQHexinPro'];

    let infoMap4 = targetInfo['EQToday'];
    let infoMap5 = targetInfo['EQTodayPro'];
    
    let infoMap6 = targetInfo['Watch'];
    let infoMap7 = targetInfo['WatchPro'];
    
    let infoMap8 = targetInfo['Watch Extension'];
    let infoMap9 = targetInfo['WatchPro Extension'];

    for(let i=0;i<SourceTags.length;i++){
        let temptag = SourceTags[i];
        let str1 = infoMap1.get(temptag);
        let str2 = infoMap2.get(temptag);
        let str3 = infoMap3.get(temptag);
        await _consistency(allSourceMap.get(str1),allSourceMap.get(str2),allSourceMap.get(str3),["EQHexin","EQHexinB","EQHexinPro"]);
        
        let str4 = infoMap4.get(temptag);
        let str5 = infoMap5.get(temptag);
        await _consistency(allSourceMap.get(str4),allSourceMap.get(str5),null,["EQToday","EQTodayPro"]);

        let str6 = infoMap6.get(temptag);
        let str7 = infoMap7.get(temptag);
        await _consistency(allSourceMap.get(str6),allSourceMap.get(str7),null,["Watch","WatchPro"]);

        let str8 = infoMap8.get(temptag);
        let str9 = infoMap9.get(temptag);
        await _consistency(allSourceMap.get(str8),allSourceMap.get(str9),null,["Watch Extension","WatchPro Extension"]);
    }
}

async function _consistency (source1,source2,source3,names) {
    if(!source1 || !source2 || !names) {
        return;
    }
    for(let item of source1){
        let res_name = item[0];
        if(source2 instanceof Map && !source2.delete(res_name)){
            await logobject.log(names[1],"缺少文件: ",source1.get(res_name),res_name);
        }
        if(source3 instanceof Map && !source3.delete(res_name)){
            await logobject.log(names[2],"缺少文件: ",source1.get(res_name),res_name);
        }
    }
    if(source3 instanceof Map) {
        await _consistency(source2,source3,null,[names[1],names[2]]);
    }

    // 这里可能存在source2和source3重复的情况
    if(source2 instanceof Map) {
        for(let item of source2){
            await logobject.log(`${names[0]} 缺少文件: ${item}`);
        }
    }
    if(source3 instanceof Map) {
        for(let item of source3){
            await logobject.log(`${names[0]} 缺少文件: ${item}`);
        }
    }
}

module.exports.checkTargetConsistency = checkTargetConsistency;