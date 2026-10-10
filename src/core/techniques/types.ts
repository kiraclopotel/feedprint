import { TechniqueName, TechniqueResult } from '../../types/analysis';

export interface ClassifierInput {
  text: string;
  author?: string;
  platform?: string;
}

export type ClassifierOutput = TechniqueResult & {
  technique: TechniqueName;
};

export interface TechniqueClassifier {
  classify(input: ClassifierInput): ClassifierOutput;
}
