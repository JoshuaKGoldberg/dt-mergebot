// @ts-check

const {getPRInfo} = require("../bin/pr-info")
const compute = require("../bin/compute-pr-actions")
const {executePrActions} = require("../bin/execute-pr-actions")
const verify = require("@octokit/webhooks/verify");
const sign = require("@octokit/webhooks/sign");

/** @type {import("@azure/functions").AzureFunction} */
const httpTrigger = async function (context, _req) {
    /** @type {import("@azure/functions").HttpRequest} */
    const req = _req

    const result = process.env["BOT_AUTH_TOKEN"] || process.env["AUTH_TOKEN"];
    if (typeof result !== 'string') {
        throw new Error("Set either BOT_AUTH_TOKEN or AUTH_TOKEN to a valid auth token");
    }

    context.log('HTTP trigger function received a request.');
    const event = req.headers["x-github-event"]

    const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
  
    // For process.env.GITHUB_WEBHOOK_SECRET see
    // https://ms.portal.azure.com/#blade/WebsitesExtension/FunctionsIFrameBlade/id/%2Fsubscriptions%2F57bfeeed-c34a-4ffd-a06b-ccff27ac91b8%2FresourceGroups%2Fdtmergebot%2Fproviders%2FMicrosoft.Web%2Fsites%2FDTMergeBot
    if (!isDev && !verify(secret, req.body, sign(secret, req.body))) {
      context.res = {
        status: 500,
        body: "This webhook did not come from GitHub"
      };
      return;
    }
  

    // Bail if not a PR
    if (event !== "pull_request") {
        context.log.info(`Skipped webhook, do not know how to handle the event: ${event}`)
        context.res = {
            status: 204,
            body: "NOOPing due to not a PR"
        }
        return
    }
    
    /** @type {import("@octokit/webhooks").WebhookPayloadPullRequest} */
    const prWebhook = req.body
    const action = prWebhook.action

    const allowListedActions = ["opened", "closed", "reopened", "edited", "synchronized"]
    if(!allowListedActions.includes(action)) {
        context.log.info(`Skipped webhook, do not know how to handle the action: ${action} on ${event}`)
        context.res = {
            status: 204,
            body: `NOOPing due to not supporting ${action} on ${event}`
        }
        return
    }


    const prNumber = prWebhook.pull_request.number

    // Allow running at the same time as the current dt bot
    if(!shouldRunOnPR(prNumber)) {
        context.log.info(`Skipped PR ${prNumber} because it did not fall in the PR range from process.env`)
        context.res = {
            status: 204,
            body: `NOOPing due to ${prNumber} not being between DT_PR_START (${process.env.DT_PR_START}) & DT_PR_END (${process.env.DT_PR_END})`
        }
        return
    }

    context.log.info(`Getting info for PR ${prNumber} - ${prWebhook.pull_request.title}`)

    // Generate the info for the PR from scratch
    const info = await getPRInfo(prNumber);
    
    // If it didn't work, bail early
    if (info.type === "fail") {
        context.log.error(`Failed because of: ${info.message}`)
        
        context.res = {
            status: 422,
            body: `Failed because of: ${info.message}`
        };

        return;
    }

    // Convert the info to a set of actions for the bot
    const actions = compute.process(info);
    
    // Act on the actions
    await executePrActions(actions);

    // We are responding real late in the process, so it might show
    // as a timeout in GH a few times (e.g. after GH/DT/NPM lookups)
    context.res = {
        status: 200,
        body: actions 
    };

    function shouldRunOnPR(number) {
        if (!process.env.DT_PR_START) return true

        const lower = Number(process.env.DT_PR_START)
        const higher = Number(process.env.DT_PR_END)
        return lower < number && number < higher
    }
};

module.exports = httpTrigger;
