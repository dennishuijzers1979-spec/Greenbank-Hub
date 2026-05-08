import { Check, Circle } from "lucide-react";

interface ProgressStepsProps {
  steps: { id: string; label: string; }[];
  currentStepIndex: number;
}

export function ProgressSteps({ steps, currentStepIndex }: ProgressStepsProps) {
  return (
    <div className="w-full py-4">
      <div className="flex items-center justify-between relative">
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-secondary -z-10 rounded-full"></div>
        
        {steps.map((step, index) => {
          const isCompleted = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;
          
          return (
            <div key={step.id} className="flex flex-col items-center gap-2 bg-background px-2 relative">
              <div 
                className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors
                  ${isCompleted ? 'bg-primary border-primary text-primary-foreground' : 
                    isCurrent ? 'bg-background border-primary text-primary' : 
                    'bg-background border-muted text-muted-foreground'}`}
              >
                {isCompleted ? <Check className="w-4 h-4" /> : <span className="text-sm font-medium">{index + 1}</span>}
              </div>
              <span className={`text-xs font-medium whitespace-nowrap absolute -bottom-6
                ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}