# Software Development and Artifact Production in an Agent-Native World

*Part I — From Automation to Human Expertise*

## 1. Beyond the Automation Predictions

One of the most remarkable developments in computer science in recent years has been the rise of LLM-driven agents, particularly their ability to generate and execute code. This technology is already reshaping professional fields that have traditionally depended on specialized knowledge and extensive training.

Microsoft AI's Mustafa Suleyman made a bold prediction about white-collar work:

> "Most of those tasks will be fully automated by an AI within the next 12 to 18 months."

I remain skeptical of such predictions, although I believe they raise several questions worth discussing.

In 2023, I used ChatGPT, powered by GPT-3.5, for the first time. Although it was presented as a chatbot, I immediately realized that the underlying technology had the potential to handle a much broader range of tasks on a computer, including programming.

My reasoning was simple: nearly a century of work in logic, programming languages, and operating systems had made a vast range of computer tasks expressible as executable instructions. If an LLM could generate those instructions and execute them through interfaces such as a shell, it could potentially do much more than chat.

That is why I was not particularly surprised by the subsequent progress of AI agents.

However, there is an important distinction between automating individual tasks and replacing an entire professional role.

A profession is rarely just a collection of isolated tasks. It also involves understanding context, deciding which problems matter, evaluating conflicting information, and determining when an action should or should not be taken.

Combining multiple specialized agents does not automatically produce a system that can reliably coordinate all these responsibilities.

Let's take coding as an example.

Agents can already inspect complicated codebases, generate substantial changes, and work across multiple components of a software system. Yet expert judgment remains important, especially when the requirements are unclear or the consequences of an error are difficult to assess.

Experienced programmers know how to ask the right questions, evaluate proposed answers, and recognize when a technically correct solution fails to address the real problem.

The process resembles a journey. Humans may define the destination and the constraints, while agents help draw the map, explore routes, and move toward the goal. Along the way, experts can determine whether the journey is making meaningful progress and whether the destination itself needs reconsideration.

In this sense, I think some of the most valuable qualities of an expert resemble those of a good reporter: keen observation, thoughtful questioning, and careful verification.

But to understand where this relationship between humans and agents may lead, we first need to understand where agents are most useful.

## 2. The Sweet Spot of AI

Across different fields, widely adopted technologies generally offer a practical balance among speed, accuracy, and cost.

They do not need to be perfect in every respect. They need to provide sufficient value under the conditions in which they are used.

LLMs have an interesting characteristic in this regard. They can often produce plausible and useful outputs quickly, without necessarily guaranteeing that those outputs are correct, complete, or optimal.

This does not make them inherently unsuitable for serious work. Human experts also make mistakes, and many traditional computational methods operate under assumptions and limitations.

What matters is whether the resulting system can deliver acceptable results reliably and economically.

This leads me to a hypothesis: perhaps some of the most successful applications of LLMs are concentrated in tasks where generating useful results is relatively inexpensive, and evaluating those results is manageable.

To examine this, I propose a simple framework with two axes:

- **Generation:** How difficult or expensive is it to produce an acceptable candidate result?
- **Verification:** How difficult or expensive is it to determine whether that result meets the required standard?

These dimensions give us four quadrants.

### The Four-Quadrant Framework

| Verification ↓ / Generation → | Easy to generate | Difficult to generate |
|---|---|---|
| **Easy to verify** | **① Fast generation, fast verification** | **② Slow generation, fast verification** |
| **Difficult to verify** | **③ Fast generation, slow verification** | **④ Slow generation, slow verification** |

I would rank these quadrants in this order when considering their suitability for direct automation, assuming comparable task value, risks, and success rates.

**The first quadrant is the most straightforward.**

If results are inexpensive to generate and inexpensive to verify, the entire process can be repeated at relatively low cost.

Code completion with clearly defined checks, structured data extraction, and rule-based document conversion can sometimes fall into this category.

**The second quadrant is also attractive.**

A task may require considerable effort to generate a successful solution, but if each attempt can be checked cheaply, an agent can repeatedly explore alternatives, identify failures, and improve its results.

Software modifications with reliable automated tests provide a useful example.

**The third quadrant is more complicated.**

Generating an output may be easy, but evaluating its quality can require substantial human expertise or time.

A model may produce a legal document, an investment argument, or a scientific explanation in seconds. Determining whether that output is reliable may be far more expensive.

**The fourth quadrant appears least attractive for direct automation.**

Both generating possible solutions and verifying them are difficult.

Complex scientific research, unfamiliar engineering problems, and certain interdisciplinary projects may fall into this category.

However, I do not think this means the fourth quadrant should be avoided entirely. I will return to that point shortly.

Before proceeding, one distinction is important: generation time is not necessarily generation cost, and verification time is not necessarily verification cost.

The economic value of automation also depends on the probability of success, the consequences of failure, and the effort required to recover from mistakes.

The four quadrants are therefore a conceptual tool for understanding tasks, not an absolute ranking of industries or business opportunities.

## 3. From Task Space to Business Strategy

If this framework is useful, it should also help AI companies decide which businesses to pursue.

For a company building agent-based products, the important question should not simply be:

"Can an agent perform this task?"

It should be:

**"Can we reliably deliver an acceptable result at a cost that makes economic sense?"**

These are different questions.

An agent might generate a working application in a few minutes, but if a professional developer must spend several hours reviewing, correcting, and deploying it, the total economic benefit may be much smaller than the generation speed suggests.

On the other hand, an agent may take an hour to solve a difficult programming problem, but if a reliable test suite can evaluate its work automatically, the entire process may still be economically attractive.

This is why I would generally give inexpensive verification a high priority.

Verification provides feedback. Feedback makes iteration possible. When the feedback process is reliable and cheap, an agent can explore, fail, recover, and improve without requiring human intervention at every step.

But this raises another question: who actually pays for verification?

A company providing AI-generated legal drafts may charge for generating documents while leaving professional review to the customer.

A coding agent may rely on tests written and maintained by its users.

A customer-service provider may charge for successfully resolved conversations, taking on more responsibility for determining whether the task was completed.

These models have different cost structures even when they use similar underlying AI technologies.

In other words, the commercial value of an AI product depends not only on how much work it automates, but also on how the costs and responsibilities of verification are distributed.

We should also consider the cost of execution itself.

Tedious operational work, coordination across different applications, unexpected errors, and deciding whether a particular action should be taken can all become important bottlenecks.

An agent that knows how to perform an action does not necessarily know whether the action is appropriate, authorized, or worth the risk.

This suggests that an important competitive advantage for AI companies may lie outside the model itself.

A company that develops reliable verification mechanisms, domain-specific evaluation standards, and effective execution environments may be able to deliver results more economically than a competitor using an equally capable model.

Rather than merely searching for existing sweet spots, businesses may create new ones by making difficult tasks easier to verify.

## 4. Why the Fourth Quadrant Still Matters

Now let us return to the fourth quadrant.

At first glance, tasks that are expensive both to generate and to verify seem like poor candidates for AI automation.

But I think we should distinguish between two objectives:

**Automating an existing task and expanding the range of problems we can explore.**

The first is primarily concerned with productivity. The second is concerned with discovery.

If we think of agents as participants in a research team, one of their most promising characteristics is their ability to connect information and methods across disciplinary boundaries.

Modern knowledge has become extraordinarily specialized.

A researcher may understand one field deeply while lacking the time and training required to master several adjacent disciplines. Yet many important problems exist precisely at the intersections between them.

Agents may help reduce the cost of exploring those intersections.

They can retrieve unfamiliar concepts, compare competing theories, propose possible connections, and assist specialists in understanding each other's work.

Of course, possessing information about many disciplines is not the same as being an expert in all of them.

A connection may appear plausible while violating fundamental assumptions in one of the fields involved.

And an interesting hypothesis is not necessarily a true one.

Nevertheless, agents may dramatically expand the number and variety of hypotheses that humans can investigate.

Consider a scientific problem that originally requires substantial effort both to generate plausible hypotheses and to evaluate them experimentally.

An agent might reduce the cost of exploring possible explanations, while experimental verification remains expensive.

The complete research problem has not necessarily become easy. But one part of the process has changed.

This distinction matters.

The commercial value of an automated workflow is often determined by its ability to deliver predictable results cheaply.

The value of a research system may instead come from discovering an explanation, method, or solution that would otherwise be too expensive to explore.

**The fourth quadrant may be the least attractive place for full automation, yet one of the most promising places for AI-assisted discovery.**

But there is a consequence.

As agents make it easier to produce hypotheses and candidate solutions, the ability to identify which ones deserve further investigation may become increasingly important.

This brings us back to human expertise.

## 5. The Changing Value of Human Expertise

If AI can generate an increasing share of professional work, what kinds of human abilities will remain valuable?

I do not think the answer is simply that humans must become better at using AI tools.

The more interesting possibility is that professional value will gradually shift toward the parts of the process that remain difficult, expensive, or poorly understood.

Based on the framework above, I expect five capabilities to become especially important.

### 1. Effective Evaluation and Feedback

The first is the ability to provide accurate, meaningful feedback quickly.

When an agent can generate dozens of candidate solutions in the time a human needs to inspect one, human evaluation may become a bottleneck.

However, speed alone is not enough.

A person who approves incorrect results quickly is not an effective evaluator. Nor is someone who spends hours producing feedback that contributes little to improving the outcome.

The valuable ability is to reduce uncertainty, identify important errors, and help the system make meaningful progress.

An even more valuable expert may be someone who can turn personal experience into reusable verification mechanisms, allowing future results to be evaluated with less human intervention.

### 2. Formulating High-Value Problems

The second is the ability to recognize which problems are worth solving.

Agents may become increasingly capable of answering well-defined questions. But the importance of a question cannot always be determined from its technical difficulty.

A difficult problem may have little practical value. A simple but overlooked problem may produce enormous benefits if solved.

People who understand real needs, identify constraints, and recognize valuable opportunities may therefore play a crucial role in directing AI capabilities toward meaningful goals.

This requires observation, knowledge, and judgment rather than the ability to produce answers alone.

### 3. Translating AI Outputs into Reality

The third is the ability to transform AI-generated results into practical outcomes.

A functioning prototype is not necessarily a usable product.

A convincing proposal is not necessarily an effective policy.

A technically correct solution is not necessarily appropriate for the environment in which it must operate.

Real-world implementation involves users, institutions, resources, maintenance, regulations, and many other constraints that may not be fully represented in the original task.

People who can bridge the gap between generated solutions and real-world requirements may become especially valuable.

Their role is not merely to execute instructions, but to determine how and when a solution should be implemented, and whether it actually produces the intended benefit.

### 4. AI-Centered Interdisciplinary Collaboration

The fourth is the ability to coordinate people and AI systems across different fields of expertise.

As agents make knowledge more accessible, it may become easier to bring together specialists who previously struggled to communicate across disciplinary boundaries.

But successful collaboration still requires shared goals, compatible assumptions, clear responsibilities, and methods for evaluating the combined results.

The most valuable collaborator may not be the person who knows everything.

Instead, it may be the person who understands how to combine different sources of expertise into a coherent process for solving a difficult problem.

### 5. Discovering Blind Spots and Proposing New Hypotheses

The fifth is perhaps the most difficult to define.

It is the ability to notice problems that existing models, evaluation systems, and accepted assumptions have overlooked.

An agent may produce an answer that passes every available test, while the tests themselves fail to capture an important requirement.

A research system may generate many hypotheses, while remaining constrained by assumptions inherited from its training data or evaluation methods.

Someone must recognize when the existing framework is insufficient.

This is not simply the ability to disagree with an AI system. A different hypothesis is not automatically a better one.

The valuable skill is the ability to identify meaningful gaps in existing knowledge and develop new hypotheses that can be investigated.

These five capabilities are not necessarily five separate professions. A single person may possess several of them, and AI systems may gradually become capable of performing more of these functions themselves.

What I am describing is not a permanent division of labor between humans and machines.

It is a possible shift in where professional value is concentrated as the cost of different activities changes.

## 6. A Different Way to Think About Talent

If this prediction is even partly correct, it may also change how organizations evaluate talent.

A higher academic qualification does not necessarily mean someone is better at providing effective feedback, identifying unfamiliar problems, or turning AI-generated work into successful real-world outcomes.

This does not make formal education irrelevant.

In many fields, deep theoretical knowledge and extensive training are essential for reliable judgment.

But academic credentials are only an indirect indicator of some of the abilities that may matter in an agent-native working environment.

Organizations may increasingly need to evaluate people through their actual ability to recognize errors, formulate problems, coordinate complex work, and improve the performance of human–AI systems.

There is another implication.

The most valuable expert may not be the person who performs the largest amount of work personally.

It may be the person who improves the entire system so that more useful work can be completed with less wasted effort.

For example, a programmer who manually corrects one hundred errors has produced value. But a programmer who recognizes the common cause of those errors and designs a test that prevents them from recurring may create even greater value.

The same principle may apply to scientific research, engineering, professional services, and many other fields.

The value of expertise may increasingly depend on how effectively it can improve the larger process of discovering, producing, verifying, and applying knowledge.

Of course, none of these predictions guarantees that human employment will remain unchanged.

If AI systems acquire better judgment, observation, and verification capabilities, some of these activities may become increasingly automated as well.

I therefore do not think the future of professional work should be understood as a fixed list of tasks that humans will always perform.

Instead, we should examine how the boundaries change, what remains difficult, and how professional knowledge continues to develop.

And that leads to a question I consider even more important.

**If the future still requires people with deep knowledge, reliable judgment, and substantial practical experience, how will those people be trained?**

Experts do not appear automatically. Their abilities are developed through education, repeated practice, mistakes, and exposure to real-world problems.

Yet many of those learning opportunities have traditionally been embedded in the very professional tasks that AI is beginning to automate.

If AI changes the way work is performed, it may also change the way expertise is developed.

This is no longer merely a question about individual careers or productivity.

It is a question about how an entire economic system maintains the knowledge and capabilities on which it depends.

And eventually, it raises another question:

**Who will bear the cost of developing that expertise, and who will gain the power to shape it?**