export {};
/**
 * Admin 面板直接调用处理（购买种子、开关设置、活动操作等）与每日礼包总览。
 */
const { st } = require('./state');
const { sendToMaster } = require('./channel');
const { applyRuntimeConfig } = require('./runtime-config');
const { getAutomation } = require('../../models/store');
const { getSchedulerRegistrySnapshot } = require('../../services/scheduler');
const { getLandsDetail, getAvailableSeeds, purchaseSeed, runFarmOperation, fertilizeOwnLand, fertilizeOwnLands, removeOwnPlants } = require('../../services/farm');
const { getFriendsList, getFriendsListCacheOnly, getFriendLandsDetail, doFriendOperation, deleteFriend } = require('../../services/friend');
const { getInteractRecords } = require('../../services/interact');
const { autoBuyFertilizer, checkAndBuyFertilizerBoth, getFreeGiftDailyState } = require('../../services/mall');
const { getTaskDailyStateLikeApp, getTaskClaimDailyState, getGrowthTaskStateLikeApp } = require('../../services/task');
const { getEmailDailyState } = require('../../services/email');
const { getShareDailyState } = require('../../services/share');
const { getMonthCardDailyState } = require('../../services/monthcard');
const { getSystemDateKey } = require('../../utils/utils');

async function handleApiCall(msg: any): Promise<void> {
    const { id, method, args } = msg;
    let result: any = null;
    let error: { message: string; code?: string | number; errorMessage?: string; name?: string } | string | null = null;

    try {
        if (method === 'applyRuntimeConfigSnapshot') {
            const appliedRevision = applyRuntimeConfig((args && args[0]) || {}, true);
            result = { appliedRevision };
        } else {
            if (!st.isRunning || st.shutdownStarted || !st.loginReady) {
                throw new Error('账号未连接');
            }
            switch (method) {
            case 'getLands':
                result = await getLandsDetail(args[0] === true);
                break;
            case 'getIllustratedSnapshot':
                result = await require('../../services/illustrated').getIllustratedSnapshot();
                break;
            case 'getCollectionsSnapshot':
                result = await require('../../services/collections').getCollectionsSnapshot();
                break;
            case 'operateCollections':
                result = await require('../../services/collections').operateCollections(args[0], args[1]);
                break;
            case 'claimIllustratedRewards':
                result = await require('../../services/illustrated').claimIllustratedRewards(args[0]);
                break;
            case 'getSolarCalendar':
                result = await require('../../services/solar-calendar').getSolarCalendar();
                break;
            case 'operateSolarCalendar':
                result = await require('../../services/solar-calendar').operateSolarCalendar(args[0], args[1]);
                break;
            case 'getFriends':
                result = await getFriendsList(args[0] === true, 'normal', args[1] === true);
                break;
            case 'getFriendsCache':
                result = getFriendsListCacheOnly();
                break;
            case 'clearFriendsCache':
                require('../../services/friend').clearFriendsListCache();
                result = { ok: true };
                break;
            case 'getInteractRecords':
                result = await getInteractRecords();
                break;
            case 'getFriendLands':
                result = await getFriendLandsDetail(args[0], args[1] === true);
                break;
            case 'getFriendInteractionItems':
                result = await require('../../services/friend-interaction-items').getFriendInteractionItems(args[0] === true);
                break;
            case 'useFriendInteractionItemBatch':
                result = await require('../../services/friend-interaction-items').useFriendInteractionItemBatch(args[0], args[1], args[2], args[3] === true);
                break;
            case 'useFriendFarmInteractionItem':
                result = await require('../../services/friend-interaction-items').useFriendFarmInteractionItem(args[0], args[1], args[2] === true);
                break;
            case 'getSelfInteractionItems':
                result = await require('../../services/friend-interaction-items').getSelfInteractionItems(args[0] === true);
                break;
            case 'useSelfInteractionItemBatch':
                result = await require('../../services/friend-interaction-items').useSelfInteractionItemBatch(args[0], args[1], args[2] === true);
                break;
            case 'doFriendOp':
                result = await doFriendOperation(args[0], args[1], args[2] === true);
                break;
            case 'delFriend':
                result = await deleteFriend(args[0]);
                break;
            case 'getSeeds':
                result = await getAvailableSeeds(args[0] === true);
                break;
            case 'purchaseSeed':
                result = await purchaseSeed(args[0], args[1]);
                break;
            case 'getBag':
                result = await require('../../services/warehouse').getBagDetail();
                break;
            case 'getBagSeeds':
                result = await require('../../services/warehouse').getBagSeeds();
                break;
            case 'getDiamondBalance':
                result = await require('../../services/pay').getDiamondBalance();
                break;
            case 'useItem': {
                const { useItem: _useItem } = require('../../services/warehouse');
                const itemId = Number(args[0]) || 0;
                const count = Math.max(1, Number(args[1]) || 1);
                const uid = Number(args[2]) || 0;
                result = await _useItem(itemId, count, [], uid);
                break;
            }
            case 'sellItems': {
                const { sellItems: _sell } = require('../../services/warehouse');
                const sellList = Array.isArray(args[0]) ? args[0] : [];
                result = await _sell(sellList.map((it: any) => ({
                    id: it.id,
                    count: it.count,
                    uid: it.uid || 0,
                    expire_time: it.expireTime ?? it.expire_time,
                })));
                break;
            }
            case 'setItemsLocked':
                result = await require('../../services/warehouse').setItemsLocked(args[0], args[1] === true);
                break;
            case 'getDogSkillGiftStatus': {
                const dogGifts = require('../../services/dog-skill-gifts');
                const info = await dogGifts.getDogInfo();
                result = { pendingCount: dogGifts.getPendingGiftCount(info) };
                break;
            }
            case 'claimDogSkillGifts':
                result = await require('../../services/dog-skill-gifts').checkAndClaimDogSkillGifts(undefined, true);
                break;
            case 'getPetInfo':
                result = await require('../../services/pets').getPetInfo();
                break;
            case 'activateDog':
                result = await require('../../services/pets').activateDog(args[0]);
                break;
            case 'deployDog':
                result = await require('../../services/pets').deployDog(args[0]);
                break;
            case 'withdrawDog':
                result = await require('../../services/pets').withdrawDog();
                break;
            case 'useDogFood':
                result = await require('../../services/pets').useDogFood(args[0], args[1], args[2]);
                break;
            case 'getPetProtectLogs':
                result = await require('../../services/pets').getProtectLogs();
                break;
            case 'setAutomation': {
                const payload = args && args[0] ? args[0] : {};
                applyRuntimeConfig({ automation: { [payload.key]: payload.value } }, true);
                result = getAutomation();
                break;
            }
            case 'doFarmOp':
                result = await runFarmOperation(args[0], args[1], args[2] === true); // opType, optional targetLandId
                break;
            case 'fertilizeOwnLand':
                result = await fertilizeOwnLand(args[0], args[1]);
                break;
            case 'fertilizeOwnLands':
                result = await fertilizeOwnLands(args[0]);
                break;
            case 'removeOwnPlants':
                result = await removeOwnPlants(args[0] === true);
                break;
            case 'fertilizeAllOwnLands':
                result = await require('../../services/farm').fertilizeAllOwnLands(args[0], args[1]);
                break;
            case 'buyFertilizer': {
                const fertilizerType = args[0] || 'organic';
                const fertilizerCount = Number(args[1]) || 0;
                result = await autoBuyFertilizer(true, fertilizerType, fertilizerCount, args[2] === true);
                break;
            }
            case 'checkAndBuyFertilizer': {
                const options = args[0] || {};
                result = await checkAndBuyFertilizerBoth(options, args[1] === true);
                break;
            }
            case 'getAnalytics': {
                const { getPlantRankings } = require('../../services/analytics');
                result = getPlantRankings(args[0]); // sortBy
                break;
            }
            case 'getDailyGiftOverview':
                result = await getDailyGiftOverview(args[0] === true);
                break;
            case 'getActivityDirectorySnapshot':
                result = await require('../../services/activity-center').getActivityDirectorySnapshot();
                break;
            case 'getActivityCenterSnapshot':
                result = await require('../../services/activity-center').getActivityCenterSnapshot();
                break;
            case 'getCurrentSeasonEvent':
                result = await require('../../services/activity-center').getCurrentSeasonEvent();
                break;
            case 'getCurrentStellarActivity':
                result = await require('../../services/activity-center').getCurrentStellarActivity();
                break;
            case 'getCurrentStarSandShop':
                result = await require('../../services/activity-center').getCurrentStarSandShop();
                break;
            case 'getCurrentSolarTerms':
                result = await require('../../services/activity-center').getCurrentSolarTerms();
                break;
            case 'getPetDiary':
                result = await require('../../services/activity-center').getPetDiary();
                break;
            case 'operatePetDiary':
                result = await require('../../services/activity-center').operatePetDiary(args[0], args[1]);
                break;
            case 'getPetDiaryRecords':
                result = await require('../../services/activity-center').getPetDiaryRecords(args[0]);
                break;
            case 'getPetDiaryFriend':
                result = await require('../../services/activity-center').getPetDiaryFriend(args[0]);
                break;
            case 'claimBattlePassRewards':
                result = await require('../../services/activity-center').claimBattlePassRewards();
                break;
            case 'exchangeStarSandGoods':
                result = await require('../../services/activity-center').exchangeStarSandGoods(args[0], args[1]);
                break;
            case 'lightConstellation':
                result = await require('../../services/activity-center').lightConstellation();
                break;
            case 'claimSolarTerm':
                result = await require('../../services/activity-center').claimSolarTerm(String(args[0] || ''));
                break;
            case 'getMilkTeaActivity':
                result = await require('../../services/milk-tea').getMilkTeaActivity(args[0], args[1]);
                break;
            case 'operateMilkTeaActivity':
                result = await require('../../services/milk-tea').operateMilkTeaActivity(args[0], args[1]);
                break;
            case 'getShareRewardActivity':
                result = await require('../../services/share-reward-activity').getShareRewardActivity(args[0]);
                break;
            case 'operateShareRewardActivity':
                result = await require('../../services/share-reward-activity').operateShareRewardActivity(args[0], args[1], args[2]);
                break;
            case 'getPropsShop':
                result = await require('../../services/commerce').getPropsShop();
                break;
            case 'purchaseProps':
                result = await require('../../services/commerce').purchaseProps(args[0], args[1], args[2]);
                break;
            case 'getMallCatalog':
                result = await require('../../services/commerce').getMallCatalog(args[0], args[1]);
                break;
            case 'purchaseMallProduct':
                result = await require('../../services/commerce').purchaseMallProduct(args[0], args[1], args[2], args[3]);
                break;
            case 'getMysteryShop':
                result = await require('../../services/commerce').getMysteryShop();
                break;
            case 'purchaseMysteryOffer':
                result = await require('../../services/commerce').purchaseMysteryOffer(args[0]);
                break;
            case 'getSchedulers':
                result = getSchedulerRegistrySnapshot();
                break;
            default:
                error = 'Unknown method';
            }
        }
    } catch (e: any) {
        error = {
            message: String(e?.message || e || 'Worker API error'),
            code: e?.code,
            errorMessage: e?.errorMessage ?? e?.error_message,
            name: String(e?.name || 'Error'),
        };
    }

    sendToMaster({ type: 'api_response', id, result, error });
}

async function getDailyGiftOverview(propagateErrors: boolean = false): Promise<any> {
    const auto = getAutomation() || {};
    const task = getTaskDailyStateLikeApp
        ? await getTaskDailyStateLikeApp(propagateErrors)
        : (getTaskClaimDailyState ? getTaskClaimDailyState() : { doneToday: false, lastClaimAt: 0 });
    const growthTask = getGrowthTaskStateLikeApp
        ? await getGrowthTaskStateLikeApp(propagateErrors)
        : { doneToday: false, completedCount: 0, totalCount: 0, tasks: [] };
    const email = getEmailDailyState ? getEmailDailyState() : { doneToday: false, lastCheckAt: 0 };
    const free = getFreeGiftDailyState ? getFreeGiftDailyState() : { doneToday: false, lastClaimAt: 0 };
    const share = getShareDailyState ? getShareDailyState() : { doneToday: false, lastClaimAt: 0 };
    const month = getMonthCardDailyState ? getMonthCardDailyState() : { doneToday: false, lastClaimAt: 0 };

    return {
        date: getSystemDateKey(),
        growth: {
            key: 'growth_task',
            label: '成长任务',
            doneToday: !!growthTask.doneToday,
            completedCount: Number(growthTask.completedCount || 0),
            totalCount: Number(growthTask.totalCount || 0),
            currentTask: growthTask.currentTask || null,
            tasks: Array.isArray(growthTask.tasks) ? growthTask.tasks : [],
        },
        gifts: [
            {
                key: 'task_claim',
                label: '每日任务',
                enabled: !!auto.task,
                doneToday: !!task.doneToday,
                lastAt: Number(task.lastClaimAt || 0),
                completedCount: Number(task.completedCount || 0),
                totalCount: Number(task.totalCount || 3),
            },
            // 以下功能默认启用，enabled 固定为 true
            { key: 'email_rewards', label: '邮箱奖励', enabled: true, doneToday: !!email.doneToday, lastAt: Number(email.lastCheckAt || 0) },
            { key: 'mall_free_gifts', label: '商城免费礼包', enabled: true, doneToday: !!free.doneToday, lastAt: Number(free.lastClaimAt || 0) },
            {
                key: 'daily_share',
                label: '分享礼包',
                enabled: true,
                mode: 'auto_claim',
                doneToday: !!share.doneToday,
                checkedToday: !!share.checkedToday,
                checkStatus: String(share.checkStatus || 'unchecked'),
                canShare: typeof share.canShare === 'boolean' ? share.canShare : null,
                lastAt: Number(share.lastClaimAt || share.lastCheckAt || 0),
            },
            {
                key: 'month_card_gift',
                label: '月卡礼包',
                enabled: true,
                doneToday: !!month.doneToday,
                lastAt: Number(month.lastClaimAt || month.lastCheckAt || 0),
                hasCard: Object.hasOwn(month, 'hasCard') ? !!month.hasCard : undefined,
                hasClaimable: Object.hasOwn(month, 'hasClaimable') ? !!month.hasClaimable : undefined,
                result: month.result || '',
            },
        ],
    };
}
module.exports = { handleApiCall, getDailyGiftOverview };
