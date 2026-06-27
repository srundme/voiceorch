import { QuizBlock } from "@/content/types";
import { useProgressStore } from "@/hooks/use-progress";
import { MarkdownText } from "@/components/MarkdownText";
import { motion, AnimatePresence } from "framer-motion";
import * as Icons from "lucide-react";
import { useRoute } from "wouter";

export function QuizBlockRenderer({ block }: { block: QuizBlock }) {
  const [match, params] = useRoute("/chapter/:slug");
  const slug = params?.slug || "unknown";
  
  const { quizAnswers, saveQuizAnswer } = useProgressStore();

  return (
    <div className="my-16 space-y-12">
      <div className="text-center mb-8">
        <h3 className="text-3xl font-serif font-bold text-foreground flex items-center justify-center gap-3">
          <Icons.HelpCircle className="text-secondary" size={32} />
          Check Yourself
        </h3>
        <p className="text-muted-foreground mt-2">Test your understanding before moving on.</p>
      </div>

      {block.questions.map((q, qIndex) => {
        const answerKey = `${slug}_${qIndex}`;
        const selectedIndex = quizAnswers[answerKey];
        const hasAnswered = selectedIndex !== undefined;
        const isCorrect = selectedIndex === q.correctIndex;

        return (
          <div key={qIndex} className="p-8 rounded-3xl bg-card border border-border shadow-sm">
            <h4 className="text-xl font-bold mb-6 text-foreground">
              <MarkdownText content={q.prompt} />
            </h4>
            
            <div className="space-y-3">
              {q.choices.map((choice, cIndex) => {
                const isSelected = selectedIndex === cIndex;
                const isThisCorrect = cIndex === q.correctIndex;
                
                let buttonClass = "bg-muted/50 border-transparent hover:border-primary/30 hover:bg-muted";
                
                if (hasAnswered) {
                  if (isThisCorrect) {
                    buttonClass = "bg-green-100 border-green-500 text-green-900";
                  } else if (isSelected) {
                    buttonClass = "bg-red-100 border-red-500 text-red-900 opacity-70";
                  } else {
                    buttonClass = "bg-muted/50 border-transparent opacity-50";
                  }
                }

                return (
                  <button
                    key={cIndex}
                    disabled={hasAnswered}
                    onClick={() => saveQuizAnswer(slug, qIndex, cIndex)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-start gap-4 ${buttonClass}`}
                  >
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                      ${hasAnswered && isThisCorrect ? "border-green-500 bg-green-500 text-white" : 
                        hasAnswered && isSelected ? "border-red-500 bg-red-500 text-white" : "border-muted-foreground/30"}`}>
                      {hasAnswered && isThisCorrect && <Icons.Check size={14} strokeWidth={3} />}
                      {hasAnswered && isSelected && !isThisCorrect && <Icons.X size={14} strokeWidth={3} />}
                    </div>
                    <div className="flex-grow font-medium">
                      <MarkdownText content={choice} />
                    </div>
                  </button>
                );
              })}
            </div>

            <AnimatePresence>
              {hasAnswered && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: "auto", marginTop: 24 }}
                  className={`p-5 rounded-2xl ${isCorrect ? "bg-green-50 text-green-900" : "bg-orange-50 text-orange-900"}`}
                >
                  <div className="flex items-start gap-3">
                    {isCorrect ? (
                      <Icons.Sparkles className="text-green-600 flex-shrink-0 mt-1" />
                    ) : (
                      <Icons.Info className="text-orange-600 flex-shrink-0 mt-1" />
                    )}
                    <div>
                      <div className="font-bold mb-1">
                        {isCorrect ? "Spot on!" : "Not quite."}
                      </div>
                      <div className="leading-relaxed opacity-90">
                        <MarkdownText content={q.explanation} />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
